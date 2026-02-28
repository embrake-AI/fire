import type { IS_Event } from "@fire/common";
import { incidentAnalysis } from "@fire/db/schema";
import { and, desc, eq, gte, inArray, ne } from "drizzle-orm";
import OpenAI from "openai";
import type { Metadata } from "../handler";
import { getDB } from "../lib/db";
import { isResponsesFunctionToolCall, parseJsonObject } from "./openai";
import type { AgentEvent, AgentIncidentSnapshot } from "./types";

const OPEN_INCIDENT_LIMIT = 20;
const COMPLETED_INCIDENT_LIMIT = 50;
const COMPLETED_LOOKBACK_DAYS = 90;
const DEEP_DIVE_EVENT_LIMIT = 25;

export const SIMILAR_PROVIDER_SYSTEM_PROMPT =
	"You are the similar-incident context provider. Call run_similar_investigation only when the incident identifies a specific failure mechanism, error class, or affected subsystem. Do not call for vague symptoms or early triage without a clear technical signal. Call once per meaningful understanding change. Do not rerun when context has not materially changed.";

export const SIMILAR_PROVIDER_SUMMARIZATION_PROMPT =
	"Summarize these new incident events into a concise context update. Focus on technical signals: failure mechanisms, error classes, affected subsystems, and impact changes. If the events contain no meaningful new technical signal (only monitoring chatter or repeated updates), respond with SKIP.";

type SimilarIncidentsDiscoveredEvent = Extract<IS_Event, { event_type: "SIMILAR_INCIDENTS_DISCOVERED" }>["event_data"];
type SimilarIncidentEvent = Extract<IS_Event, { event_type: "SIMILAR_INCIDENT" }>["event_data"];

type SimilarIncidentPersistenceApi = {
	recordAgentContextEvent: (
		eventType: "SIMILAR_INCIDENTS_DISCOVERED",
		eventData: SimilarIncidentsDiscoveredEvent,
		dedupeKey: string,
	) => Promise<{ eventId: number; createdAt: string } | { error: string }>;
	recordAgentInsightEvent: (
		eventType: "SIMILAR_INCIDENT",
		eventData: SimilarIncidentEvent,
		dedupeKey: string,
	) => Promise<{ eventId: number; createdAt: string; deduped?: boolean } | { error: string }>;
};

type StepDo = <T extends Rpc.Serializable<T>>(name: string, callback: () => Promise<T>) => Promise<T>;

type RunSimilarIncidentFlowParams = {
	env: Env;
	incidentId: string;
	turnId: string;
	metadata: Metadata;
	incident: AgentIncidentSnapshot;
	events: AgentEvent[];
	stepDo: StepDo;
	persistence: SimilarIncidentPersistenceApi;
	investigationReason?: string;
};

export type RankingDecision = {
	rankedIncidentIds: string[];
	selectedIncidentIds: string[];
	reason: string;
	contextSnapshot: string;
	changedUnderstanding: string;
};

export type DeepDiveDecision = {
	isSimilar: boolean;
	summary: string;
	evidence: string;
	comparisonContext: string;
};

type OpenIncidentCandidate = {
	id: string;
	status: string;
	severity: string;
	title: string;
	description: string;
	createdAt: string;
};

type CompletedIncidentCandidate = {
	id: string;
	terminalStatus: "resolved" | "declined";
	severity: string;
	title: string;
	description: string;
	createdAt: string;
	resolvedAt: string;
};

type SimilarIncidentCandidate = (OpenIncidentCandidate & { kind: "open" }) | (CompletedIncidentCandidate & { kind: "completed" });

export type SimilarProviderToolCall = {
	toolCallId: string;
	reason: string;
	evidence: string;
	argumentsText: string;
};

export type SimilarProviderDecision = {
	assistantContent: string;
	toolCalls: SimilarProviderToolCall[];
};

function truncate(value: string, max = 220) {
	const trimmed = value.trim();
	if (trimmed.length <= max) {
		return trimmed;
	}
	return `${trimmed.slice(0, max - 1)}...`;
}

export const RANKING_SYSTEM_PROMPT = `You rank historical incidents for practical reuse in the current incident.
Selection criteria:
- Must have mechanism-level compatibility OR clearly transferable mitigation playbook.
- Prefer overlap in trigger, impact pattern, and affected subsystem.
- Exclude incidents that only share generic symptoms or business-domain words.
- selectedIncidentIds may be empty; prioritize precision over recall when uncertain.
- Return contextSnapshot and changedUnderstanding to be persisted with the search event.`;

export const DEEP_DIVE_SYSTEM_PROMPT = `You are a strict deep-dive validator for incident similarity.
Return isSimilar=true only if the candidate can directly inform current diagnosis or mitigation.
Require explicit evidence of mechanism overlap and operationally relevant lessons.
Reject surface-level similarity (same symptom words, different underlying cause).
When evidence is mixed, return false.`;

export const RANKING_SCHEMA = {
	type: "object",
	properties: {
		rankedIncidentIds: { type: "array", items: { type: "string" } },
		selectedIncidentIds: { type: "array", items: { type: "string" } },
		reason: { type: "string" },
		contextSnapshot: { type: "string" },
		changedUnderstanding: { type: "string" },
	},
	required: ["rankedIncidentIds", "selectedIncidentIds", "reason", "contextSnapshot", "changedUnderstanding"],
	additionalProperties: false,
} as const;

export const DEEP_DIVE_SCHEMA = {
	type: "object",
	properties: {
		isSimilar: { type: "boolean" },
		summary: { type: "string" },
		evidence: { type: "string" },
		comparisonContext: { type: "string" },
	},
	required: ["isSimilar", "summary", "evidence", "comparisonContext"],
	additionalProperties: false,
} as const;

export function buildRankingUserPrompt(params: {
	incident: { id: string; title: string; description: string; status: string; severity: string };
	candidates: Array<{ id: string; kind: "open" | "completed"; status: string; severity: string; title: string; description: string; createdAt: string; resolvedAt?: string }>;
	investigationReason?: string;
}): string {
	const candidatesText = params.candidates
		.map((candidate, index) => {
			const recency = candidate.kind === "completed" && candidate.resolvedAt ? `resolvedAt=${candidate.resolvedAt}` : `createdAt=${candidate.createdAt}`;
			return `${index + 1}. id=${candidate.id} kind=${candidate.kind} status=${candidate.status} severity=${candidate.severity} ${recency} title="${truncate(candidate.title, 100)}" description="${truncate(candidate.description, 250)}"`;
		})
		.join("\n");

	return `Current incident:
- id: ${params.incident.id}
- title: ${params.incident.title}
- description: ${params.incident.description}
- status: ${params.incident.status}
- severity: ${params.incident.severity}
- reason for running search: ${params.investigationReason ?? "Model requested similar incident lookup"}

Candidate incidents:
${candidatesText}

Return ranking and selected ids.`;
}

export function buildDeepDiveUserPrompt(params: {
	incident: { id: string; title: string; description: string; status: string; severity: string };
	contextSnapshot: string;
	candidate: {
		id: string;
		kind: "open" | "completed";
		title: string;
		description: string;
		status: string;
		severity: string;
		createdAt: string;
		resolvedAt?: string;
		prompt: string;
		rootCause?: string;
		impact?: string;
		eventsSummary: string;
	};
}): string {
	return `Current incident:
- id: ${params.incident.id}
- title: ${params.incident.title}
- description: ${params.incident.description}
- status: ${params.incident.status}
- severity: ${params.incident.severity}
- context: ${params.contextSnapshot}

Candidate incident:
- id: ${params.candidate.id}
- kind: ${params.candidate.kind}
- title: ${params.candidate.title}
- description: ${params.candidate.description}
- status: ${params.candidate.status}
- severity: ${params.candidate.severity}
- createdAt: ${params.candidate.createdAt}
- resolvedAt: ${params.candidate.resolvedAt ?? "n/a"}
- prompt: ${params.candidate.prompt}
- rootCause: ${params.candidate.rootCause ?? ""}
- impact: ${params.candidate.impact ?? ""}

Candidate event summary:
${params.candidate.eventsSummary}

Return deep-dive verdict.`;
}

function toAgentEvent(recorded: { eventId: number; createdAt: string }, event_type: AgentEvent["event_type"], event_data: AgentEvent["event_data"]): AgentEvent {
	return {
		id: recorded.eventId,
		event_type,
		event_data,
		created_at: recorded.createdAt,
		adapter: "fire",
		event_metadata: null,
	};
}

function stringifyEventData(eventData: unknown) {
	try {
		return JSON.stringify(eventData);
	} catch {
		return "{}";
	}
}

function summarizeEvents(events: Array<{ event_type: string; event_data: unknown; created_at: string }>) {
	if (!events.length) {
		return "(no events)";
	}
	return events
		.slice(-DEEP_DIVE_EVENT_LIMIT)
		.map((event) => `[${event.created_at}] ${event.event_type}: ${truncate(stringifyEventData(event.event_data), 200)}`)
		.join("\n");
}

function parseEventData(value: string) {
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return {};
	}
}

export async function answerSimilarProviderPrompt(params: { openaiApiKey: string; input: OpenAI.Responses.ResponseInputItem[]; model?: string }): Promise<string> {
	const client = new OpenAI({ apiKey: params.openaiApiKey });
	const response = await client.responses.create({
		model: params.model ?? "gpt-5.2",
		input: params.input,
		text: { verbosity: "low" },
	});
	const content = response.output_text.trim();
	if (content) {
		return content;
	}
	return "No additional similar-incident insight is available yet.";
}

export async function decideSimilarProviderAction(params: { openaiApiKey: string; input: OpenAI.Responses.ResponseInputItem[]; model?: string }): Promise<SimilarProviderDecision> {
	const client = new OpenAI({ apiKey: params.openaiApiKey });
	const response = await client.responses.create({
		model: params.model ?? "gpt-5.2",
		input: params.input,
		tools: [
			{
				type: "function",
				name: "run_similar_investigation",
				description: "Run or re-run similar incident investigation for the latest incident context. Call only when context is concrete enough to produce reliable matches.",
				strict: true,
				parameters: {
					type: "object",
					properties: {
						reason: { type: "string", description: "Why similar incident investigation is useful now." },
						evidence: { type: "string", description: "Specific event evidence supporting this run." },
					},
					required: ["reason", "evidence"],
					additionalProperties: false,
				},
			},
		],
		tool_choice: "auto",
		text: { verbosity: "low" },
	});

	const assistantContent = response.output_text.trim();
	const toolCalls: SimilarProviderToolCall[] = [];

	for (const item of response.output ?? []) {
		if (!isResponsesFunctionToolCall(item) || item.name !== "run_similar_investigation") {
			continue;
		}

		const parsed = parseJsonObject(item.arguments);
		const reason = typeof parsed.reason === "string" ? parsed.reason.trim() : "";
		const evidence = typeof parsed.evidence === "string" ? parsed.evidence.trim() : "";
		if (!reason || !evidence) {
			continue;
		}
		const argumentsText = JSON.stringify({ reason, evidence });
		toolCalls.push({
			toolCallId: item.call_id,
			reason,
			evidence,
			argumentsText,
		});
	}

	return {
		assistantContent,
		toolCalls,
	};
}

async function callJsonSchema<T>(params: { openaiApiKey: string; systemPrompt: string; userPrompt: string; schemaName: string; schema: unknown }): Promise<T> {
	const client = new OpenAI({ apiKey: params.openaiApiKey });
	const response = await client.responses.create({
		model: "gpt-5.2",
		input: [
			{ role: "system", content: params.systemPrompt },
			{ role: "user", content: params.userPrompt },
		],
		text: {
			format: {
				type: "json_schema",
				name: params.schemaName,
				schema: params.schema as Record<string, unknown>,
				strict: true,
			},
			verbosity: "low",
		},
	});
	const content = response.output_text.trim();
	if (!content) {
		throw new Error("Missing OpenAI response content");
	}
	return JSON.parse(content) as T;
}

async function loadOpenCandidates(params: RunSimilarIncidentFlowParams): Promise<OpenIncidentCandidate[]> {
	const result = await params.stepDo(`agent-similar.open:${params.turnId}`, async () => {
		const response = await params.env.incidents
			.prepare("SELECT id, status, severity, title, description, createdAt FROM incident WHERE client_id = ? AND id != ? ORDER BY datetime(createdAt) DESC LIMIT ?")
			.bind(params.metadata.clientId, params.incident.id, OPEN_INCIDENT_LIMIT)
			.all<OpenIncidentCandidate>();
		return response.results;
	});
	return result.map((row) => ({
		id: row.id,
		status: row.status,
		severity: row.severity,
		title: row.title,
		description: row.description,
		createdAt: row.createdAt,
	}));
}

async function loadCompletedCandidates(params: RunSimilarIncidentFlowParams): Promise<CompletedIncidentCandidate[]> {
	const db = getDB(params.env.db);
	const lowerBound = new Date(Date.now() - COMPLETED_LOOKBACK_DAYS * 24 * 60 * 60 * 1_000);
	return params.stepDo(`agent-similar.closed:${params.turnId}`, async () => {
		const rows = await db
			.select({
				id: incidentAnalysis.id,
				terminalStatus: incidentAnalysis.terminalStatus,
				severity: incidentAnalysis.severity,
				title: incidentAnalysis.title,
				description: incidentAnalysis.description,
				createdAt: incidentAnalysis.createdAt,
				resolvedAt: incidentAnalysis.resolvedAt,
			})
			.from(incidentAnalysis)
			.where(
				and(
					eq(incidentAnalysis.clientId, params.metadata.clientId),
					ne(incidentAnalysis.id, params.incident.id),
					gte(incidentAnalysis.resolvedAt, lowerBound),
					inArray(incidentAnalysis.terminalStatus, ["resolved", "declined"]),
				),
			)
			.orderBy(desc(incidentAnalysis.resolvedAt))
			.limit(COMPLETED_INCIDENT_LIMIT);
		return rows.map((row) => ({
			id: row.id,
			terminalStatus: row.terminalStatus,
			severity: row.severity,
			title: row.title,
			description: row.description,
			createdAt: row.createdAt.toISOString(),
			resolvedAt: row.resolvedAt.toISOString(),
		}));
	});
}

async function rankCandidates(params: RunSimilarIncidentFlowParams, candidates: SimilarIncidentCandidate[]): Promise<RankingDecision> {
	if (!candidates.length) {
		return {
			rankedIncidentIds: [],
			selectedIncidentIds: [],
			reason: "No candidates available.",
			contextSnapshot: "No similar-incident candidates were available for this tenant and window.",
			changedUnderstanding: "",
		};
	}

	const userPrompt = buildRankingUserPrompt({
		incident: params.incident,
		candidates: candidates.map((candidate) => ({
			id: candidate.id,
			kind: candidate.kind,
			status: candidate.kind === "open" ? candidate.status : candidate.terminalStatus,
			severity: candidate.severity,
			title: candidate.title,
			description: candidate.description,
			createdAt: candidate.createdAt,
			resolvedAt: candidate.kind === "completed" ? candidate.resolvedAt : undefined,
		})),
		investigationReason: params.investigationReason,
	});

	const result = await params.stepDo(`agent-similar.rank:${params.turnId}`, async () =>
		callJsonSchema<RankingDecision>({
			openaiApiKey: params.env.OPENAI_API_KEY,
			systemPrompt: RANKING_SYSTEM_PROMPT,
			userPrompt,
			schemaName: "similar_incident_ranking",
			schema: RANKING_SCHEMA,
		}),
	);

	const allowedIds = new Set(candidates.map((candidate) => candidate.id));
	return {
		rankedIncidentIds: Array.from(new Set(result.rankedIncidentIds.filter((id) => allowedIds.has(id)))),
		selectedIncidentIds: Array.from(new Set(result.selectedIncidentIds.filter((id) => allowedIds.has(id)))),
		reason: truncate(result.reason, 320),
		contextSnapshot: truncate(result.contextSnapshot, 500),
		changedUnderstanding: truncate(result.changedUnderstanding, 500),
	};
}

async function loadCandidateDeepDiveData(params: RunSimilarIncidentFlowParams, candidate: SimilarIncidentCandidate) {
	if (candidate.kind === "open") {
		const incidentStub = params.env.INCIDENT.get(params.env.INCIDENT.idFromString(candidate.id));
		const result = await incidentStub.get();
		if ("error" in result) {
			return null;
		}
		const summary = summarizeEvents(
			result.events.map((event) => ({
				event_type: event.event_type,
				event_data: parseEventData(event.event_data),
				created_at: event.created_at,
			})),
		);
		const createdAt = result.state.createdAt instanceof Date ? result.state.createdAt.toISOString() : new Date(result.state.createdAt).toISOString();
		return {
			id: result.state.id,
			kind: "open" as const,
			status: result.state.status,
			severity: result.state.severity,
			title: result.state.title,
			description: result.state.description,
			prompt: result.state.prompt,
			createdAt,
			eventsSummary: summary,
		};
	}

	const db = getDB(params.env.db);
	const [row] = await db
		.select({
			id: incidentAnalysis.id,
			title: incidentAnalysis.title,
			description: incidentAnalysis.description,
			severity: incidentAnalysis.severity,
			prompt: incidentAnalysis.prompt,
			terminalStatus: incidentAnalysis.terminalStatus,
			createdAt: incidentAnalysis.createdAt,
			resolvedAt: incidentAnalysis.resolvedAt,
			events: incidentAnalysis.events,
			rootCause: incidentAnalysis.rootCause,
			impact: incidentAnalysis.impact,
		})
		.from(incidentAnalysis)
		.where(and(eq(incidentAnalysis.id, candidate.id), eq(incidentAnalysis.clientId, params.metadata.clientId)))
		.limit(1);
	if (!row) {
		return null;
	}

	return {
		id: row.id,
		kind: "completed" as const,
		status: row.terminalStatus,
		severity: row.severity,
		title: row.title,
		description: row.description,
		prompt: row.prompt,
		createdAt: row.createdAt.toISOString(),
		resolvedAt: row.resolvedAt.toISOString(),
		rootCause: row.rootCause ?? "",
		impact: row.impact ?? "",
		eventsSummary: summarizeEvents(
			row.events.map((event) => ({
				event_type: event.event_type,
				event_data: event.event_data,
				created_at: event.created_at,
			})),
		),
	};
}

async function runDeepDive(params: RunSimilarIncidentFlowParams, runId: string, candidate: SimilarIncidentCandidate, contextSnapshot: string, knownEventIds: Set<number>) {
	return params.stepDo(`agent-similar.deep-dive:${params.turnId}:${candidate.id}`, async () => {
		const detail = await loadCandidateDeepDiveData(params, candidate);
		if (!detail) {
			return null;
		}

		const deepDiveUserPrompt = buildDeepDiveUserPrompt({
			incident: params.incident,
			contextSnapshot,
			candidate: {
				id: detail.id,
				kind: detail.kind,
				title: detail.title,
				description: detail.description,
				status: detail.status,
				severity: detail.severity,
				createdAt: detail.createdAt,
				resolvedAt: "resolvedAt" in detail ? detail.resolvedAt : undefined,
				prompt: detail.prompt,
				rootCause: "rootCause" in detail ? detail.rootCause : undefined,
				impact: "impact" in detail ? detail.impact : undefined,
				eventsSummary: detail.eventsSummary,
			},
		});

		const verdict = await callJsonSchema<DeepDiveDecision>({
			openaiApiKey: params.env.OPENAI_API_KEY,
			systemPrompt: DEEP_DIVE_SYSTEM_PROMPT,
			userPrompt: deepDiveUserPrompt,
			schemaName: "similar_incident_deep_dive",
			schema: DEEP_DIVE_SCHEMA,
		});

		if (!verdict.isSimilar) {
			return null;
		}

		const eventData: SimilarIncidentEvent = {
			originRunId: runId,
			similarIncidentId: candidate.id,
			sourceIncidentIds: [candidate.id],
			summary: truncate(verdict.summary, 400),
			evidence: truncate(verdict.evidence, 500),
			comparisonContext: truncate(verdict.comparisonContext, 320),
		};
		const dedupeKey = `${eventData.originRunId}:${eventData.similarIncidentId}`;
		const recorded = await params.persistence.recordAgentInsightEvent("SIMILAR_INCIDENT", eventData, dedupeKey);
		if ("error" in recorded) {
			return null;
		}
		if (recorded.deduped && knownEventIds.has(recorded.eventId)) {
			return null;
		}
		knownEventIds.add(recorded.eventId);
		return toAgentEvent(recorded, "SIMILAR_INCIDENT", eventData);
	});
}

export async function runSimilarIncidentFlow(params: RunSimilarIncidentFlowParams): Promise<{ appendedEvents: AgentEvent[] }> {
	const runId = `${params.incidentId}:${params.turnId}:similar-search`;
	const searchedAt = new Date().toISOString();

	let openCandidates: OpenIncidentCandidate[] = [];
	let completedCandidates: CompletedIncidentCandidate[] = [];
	try {
		[openCandidates, completedCandidates] = await Promise.all([loadOpenCandidates(params), loadCompletedCandidates(params)]);
	} catch (error) {
		console.error("Failed to load similar incident candidates", error);
		const failedEvent: SimilarIncidentsDiscoveredEvent = {
			runId,
			searchedAt,
			contextSnapshot: "Candidate retrieval failed.",
			gateDecision: "error",
			gateReason: "Candidate retrieval failed",
			openCandidateCount: 0,
			closedCandidateCount: 0,
			rankedIncidentIds: [],
			selectedIncidentIds: [],
		};
		const failed = await params.persistence.recordAgentContextEvent("SIMILAR_INCIDENTS_DISCOVERED", failedEvent, runId);
		if ("error" in failed) {
			return { appendedEvents: [] };
		}
		return {
			appendedEvents: [toAgentEvent(failed, "SIMILAR_INCIDENTS_DISCOVERED", failedEvent)],
		};
	}

	const candidates: SimilarIncidentCandidate[] = [
		...openCandidates.map((candidate) => ({ ...candidate, kind: "open" as const })),
		...completedCandidates.map((candidate) => ({ ...candidate, kind: "completed" as const })),
	];

	let ranking: RankingDecision = {
		rankedIncidentIds: [],
		selectedIncidentIds: [],
		reason: "No ranking performed",
		contextSnapshot: params.investigationReason ?? "Similar incident search requested by suggestion tool.",
		changedUnderstanding: "",
	};
	try {
		ranking = await rankCandidates(params, candidates);
	} catch (error) {
		console.error("Similar incident ranking failed", error);
	}

	const discoveryEventData: SimilarIncidentsDiscoveredEvent = {
		runId,
		searchedAt,
		contextSnapshot: ranking.contextSnapshot,
		gateDecision: "run",
		gateReason: `${params.investigationReason ? `${params.investigationReason} | ` : ""}${ranking.reason}`,
		changedUnderstanding: ranking.changedUnderstanding,
		openCandidateCount: openCandidates.length,
		closedCandidateCount: completedCandidates.length,
		rankedIncidentIds: ranking.rankedIncidentIds,
		selectedIncidentIds: ranking.selectedIncidentIds,
	};

	const discovery = await params.persistence.recordAgentContextEvent("SIMILAR_INCIDENTS_DISCOVERED", discoveryEventData, runId);
	const appendedEvents: AgentEvent[] = [];
	if (!("error" in discovery)) {
		appendedEvents.push(toAgentEvent(discovery, "SIMILAR_INCIDENTS_DISCOVERED", discoveryEventData));
	}

	if (!ranking.selectedIncidentIds.length) {
		return { appendedEvents };
	}

	const selectedMap = new Map(candidates.map((candidate) => [candidate.id, candidate]));
	const knownEventIds = new Set(params.events.map((event) => event.id));
	for (const event of appendedEvents) {
		knownEventIds.add(event.id);
	}
	const deepDiveTasks = ranking.selectedIncidentIds
		.map((id) => selectedMap.get(id))
		.filter((candidate): candidate is SimilarIncidentCandidate => !!candidate)
		.map((candidate) => runDeepDive(params, runId, candidate, ranking.contextSnapshot, knownEventIds));
	const deepDiveResults = await Promise.allSettled(deepDiveTasks);
	for (const result of deepDiveResults) {
		if (result.status === "fulfilled" && result.value) {
			appendedEvents.push(result.value);
		}
		if (result.status === "rejected") {
			console.error("Similar incident deep dive failed", result.reason);
		}
	}

	return { appendedEvents };
}
