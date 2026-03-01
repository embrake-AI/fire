import { type IS_Event, truncate } from "@fire/common";
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
	"You are the similar-incident context provider. You have candidate incidents loaded in context. Use the investigate_incident tool to deep-dive into any candidate that looks potentially relevant. Call it eagerly and early — a described symptom and affected area is enough. Do not wait for confirmed root cause or specific error classes. Historical context is most valuable during initial triage. You may call investigate_incident multiple times in parallel for different candidates. Re-investigate only when understanding materially changes (new subsystem, new failure mechanism, scope change). Do not re-investigate for repeated updates or monitoring chatter. When answering questions, only state facts from the conversation (incident events, investigation results, similar incidents found). Never speculate or list hypothetical causes/mitigations. If no similar incidents have been found yet, say so briefly.";

export const SIMILAR_PROVIDER_SUMMARIZATION_PROMPT =
	"Summarize these new incident events into a concise context update. Focus on technical signals: failure mechanisms, error classes, affected subsystems, and impact changes. If the events contain no meaningful new technical signal (only monitoring chatter or repeated updates), respond with SKIP. Do not speculate or add information not present in the events.";

type SimilarIncidentEvent = Extract<IS_Event, { event_type: "SIMILAR_INCIDENT" }>["event_data"];

export type SimilarIncidentPersistenceApi = {
	recordAgentContextEvent: (
		eventType: "SIMILAR_INCIDENTS_DISCOVERED",
		eventData: Extract<IS_Event, { event_type: "SIMILAR_INCIDENTS_DISCOVERED" }>["event_data"],
		dedupeKey: string,
	) => Promise<{ eventId: number; createdAt: string } | { error: string }>;
	recordAgentInsightEvent: (
		eventType: "SIMILAR_INCIDENT",
		eventData: SimilarIncidentEvent,
		dedupeKey: string,
	) => Promise<{ eventId: number; createdAt: string; deduped?: boolean } | { error: string }>;
};

export type DeepDiveDecision = {
	isSimilar: boolean;
	similarities: string;
	learnings: string;
};

export type OpenIncidentCandidate = {
	id: string;
	status: string;
	severity: string;
	title: string;
	description: string;
	createdAt: string;
};

export type CompletedIncidentCandidate = {
	id: string;
	terminalStatus: "resolved" | "declined";
	severity: string;
	title: string;
	description: string;
	createdAt: string;
	resolvedAt: string;
};

export type SimilarIncidentCandidate = (OpenIncidentCandidate & { kind: "open" }) | (CompletedIncidentCandidate & { kind: "completed" });

export type SimilarProviderToolCall = {
	toolCallId: string;
	incidentId: string;
	reason: string;
	argumentsText: string;
};

export type SimilarProviderDecision = {
	assistantContent: string;
	toolCalls: SimilarProviderToolCall[];
};

export const DEEP_DIVE_SYSTEM_PROMPT = `You are a strict deep-dive validator for incident similarity.
Return isSimilar=true only if the candidate can directly inform current diagnosis or mitigation.
Require explicit evidence of mechanism overlap and operationally relevant lessons.
Reject surface-level similarity (same symptom words, different underlying cause).
When evidence is mixed, return false.
In similarities, describe shared mechanisms, symptoms, and subsystems.
In learnings, describe resolution steps, mitigations, and applicable actions from the candidate.`;

export const DEEP_DIVE_SCHEMA = {
	type: "object",
	properties: {
		isSimilar: { type: "boolean" },
		similarities: { type: "string" },
		learnings: { type: "string" },
	},
	required: ["isSimilar", "similarities", "learnings"],
	additionalProperties: false,
} as const;

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
				name: "investigate_incident",
				description:
					"Run deep-dive investigation on a single candidate incident. Call once per incident you want to investigate. You may call this multiple times in parallel for different candidates.",
				strict: true,
				parameters: {
					type: "object",
					properties: {
						incidentId: { type: "string", description: "The ID of the candidate incident to investigate." },
						reason: { type: "string", description: "Why this candidate is worth investigating for the current incident." },
					},
					required: ["incidentId", "reason"],
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
		if (!isResponsesFunctionToolCall(item) || item.name !== "investigate_incident") {
			continue;
		}

		const parsed = parseJsonObject(item.arguments);
		const incidentId = typeof parsed.incidentId === "string" ? parsed.incidentId.trim() : "";
		const reason = typeof parsed.reason === "string" ? parsed.reason.trim() : "";
		if (!incidentId || !reason) {
			continue;
		}
		const argumentsText = JSON.stringify({ incidentId, reason });
		toolCalls.push({
			toolCallId: item.call_id,
			incidentId,
			reason,
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
		},
	});
	const content = response.output_text.trim();
	if (!content) {
		throw new Error("Missing OpenAI response content");
	}
	return JSON.parse(content) as T;
}

export async function loadOpenCandidates(params: { env: Env; clientId: string; incidentId: string }): Promise<OpenIncidentCandidate[]> {
	const response = await params.env.incidents
		.prepare("SELECT id, status, severity, title, description, createdAt FROM incident WHERE client_id = ? AND id != ? ORDER BY datetime(createdAt) DESC LIMIT ?")
		.bind(params.clientId, params.incidentId, OPEN_INCIDENT_LIMIT)
		.all<OpenIncidentCandidate>();
	return response.results.map((row) => ({
		id: row.id,
		status: row.status,
		severity: row.severity,
		title: row.title,
		description: row.description,
		createdAt: row.createdAt,
	}));
}

export async function loadCompletedCandidates(params: { env: Env; clientId: string; incidentId: string }): Promise<CompletedIncidentCandidate[]> {
	const db = getDB(params.env.db);
	const lowerBound = new Date(Date.now() - COMPLETED_LOOKBACK_DAYS * 24 * 60 * 60 * 1_000);
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
				eq(incidentAnalysis.clientId, params.clientId),
				ne(incidentAnalysis.id, params.incidentId),
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
}

export function formatCandidatesForContext(candidates: SimilarIncidentCandidate[]): string {
	if (!candidates.length) {
		return "No candidate incidents available.";
	}
	return candidates
		.map((candidate, index) => {
			const status = candidate.kind === "open" ? candidate.status : candidate.terminalStatus;
			const recency = candidate.kind === "completed" ? `resolvedAt=${candidate.resolvedAt}` : `createdAt=${candidate.createdAt}`;
			return `${index + 1}. id=${candidate.id} kind=${candidate.kind} status=${status} severity=${candidate.severity} ${recency} title="${truncate(candidate.title, 100)}" description="${truncate(candidate.description, 250)}"`;
		})
		.join("\n");
}

export type RunDeepDiveParams = {
	env: Env;
	incidentId: string;
	incident: AgentIncidentSnapshot;
	metadata: Metadata;
	persistence: SimilarIncidentPersistenceApi;
	knownEventIds: Set<number>;
};

export async function runDeepDive(
	params: RunDeepDiveParams,
	runId: string,
	candidateId: string,
	reason: string,
	candidates: SimilarIncidentCandidate[],
): Promise<{ result: string; event: AgentEvent | null }> {
	const candidate = candidates.find((c) => c.id === candidateId);
	if (!candidate) {
		return { result: JSON.stringify({ title: "Unknown", isSimilar: false, similarities: `Candidate ${candidateId} not found in loaded candidates.`, learnings: "" }), event: null };
	}

	const detail = await loadCandidateDeepDiveData(params, candidate);
	if (!detail) {
		return { result: JSON.stringify({ title: candidate.title, isSimilar: false, similarities: "Could not load candidate details.", learnings: "" }), event: null };
	}

	const contextSnapshot = reason;
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

	const candidateStatus = candidate.kind === "open" ? candidate.status : candidate.terminalStatus;
	const toolResult = {
		title: detail.title,
		isSimilar: verdict.isSimilar,
		similarities: truncate(verdict.similarities, 500),
		...(verdict.isSimilar ? { learnings: truncate(verdict.learnings, 500) } : {}),
	};

	if (!verdict.isSimilar) {
		return { result: JSON.stringify(toolResult), event: null };
	}

	const eventData: SimilarIncidentEvent = {
		originRunId: runId,
		similarIncidentId: candidate.id,
		sourceIncidentIds: [candidate.id],
		title: detail.title,
		incidentStatus: candidateStatus,
		summary: truncate(verdict.similarities, 400),
		similarities: truncate(verdict.similarities, 500),
		learnings: truncate(verdict.learnings, 500),
	};
	const dedupeKey = `${eventData.originRunId}:${eventData.similarIncidentId}`;
	const recorded = await params.persistence.recordAgentInsightEvent("SIMILAR_INCIDENT", eventData, dedupeKey);
	if ("error" in recorded) {
		return { result: JSON.stringify(toolResult), event: null };
	}
	if (recorded.deduped && params.knownEventIds.has(recorded.eventId)) {
		return { result: JSON.stringify(toolResult), event: null };
	}
	params.knownEventIds.add(recorded.eventId);
	return { result: JSON.stringify(toolResult), event: toAgentEvent(recorded, "SIMILAR_INCIDENT", eventData) };
}

async function loadCandidateDeepDiveData(params: { env: Env; metadata: Metadata }, candidate: SimilarIncidentCandidate) {
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
