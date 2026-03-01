/**
 * Evaluation harness for similar-incident prompts.
 *
 * Usage:
 *   OPENAI_API_KEY=... bun services/incidentd/src/agent/eval.similar-incidents.test.ts
 *   OPENAI_API_KEY=... bun services/incidentd/src/agent/eval.similar-incidents.test.ts --section=provider-decision --runs=3
 *   OPENAI_API_KEY=... bun services/incidentd/src/agent/eval.similar-incidents.test.ts --section=summarization --runs=3
 *   OPENAI_API_KEY=... bun services/incidentd/src/agent/eval.similar-incidents.test.ts --out=/tmp/sim-eval.json
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import OpenAI from "openai";
import { formatAgentEventForPrompt, isInternalAgentEvent } from "./event-format";
import type { DeepDiveDecision, SimilarProviderDecision } from "./similar-incidents";
import {
	buildDeepDiveUserPrompt,
	DEEP_DIVE_SCHEMA,
	DEEP_DIVE_SYSTEM_PROMPT,
	decideSimilarProviderAction,
	SIMILAR_PROVIDER_SUMMARIZATION_PROMPT,
	SIMILAR_PROVIDER_SYSTEM_PROMPT,
} from "./similar-incidents";
import { normalizeEventData } from "./suggestions";
import type { AgentEvent } from "./types";

type EvalSection = "all" | "provider-decision" | "deep-dive" | "summarization";

type ProviderDecisionScenario = {
	id: string;
	name: string;
	expectedCallsTool: boolean;
	/** When expectedCallsTool=true, candidate IDs the model is allowed to investigate */
	expectedIncidentIds?: string[];
	input: OpenAI.Responses.ResponseInputItem[];
};

type DeepDiveScenario = {
	id: string;
	name: string;
	expectedSimilar: boolean;
	input: {
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
	};
};

type SummarizationScenario = {
	id: string;
	name: string;
	expectSkip: boolean;
	/** If not SKIP, keywords that should appear (case-insensitive) in the summary */
	expectedSignals?: string[];
	events: AgentEvent[];
	existingInput?: OpenAI.Responses.ResponseInputItem[];
};

type SummarizationResult = {
	summary: string | null;
};

type ScenarioRunResult = {
	section: Exclude<EvalSection, "all">;
	scenarioId: string;
	scenarioName: string;
	runIndex: number;
	ok: boolean;
	note: string;
	raw: SimilarProviderDecision | DeepDiveDecision | SummarizationResult;
};

type EvalSummary = {
	createdAt: string;
	model: string;
	section: EvalSection;
	runsPerScenario: number;
	totals: {
		scenarioRuns: number;
		passes: number;
		fails: number;
		passRate: number;
	};
	bySection: Record<Exclude<EvalSection, "all">, { scenarioRuns: number; passes: number; fails: number; passRate: number }>;
	results: ScenarioRunResult[];
};

async function callJsonSchema<T>(params: { apiKey: string; model: string; systemPrompt: string; userPrompt: string; schemaName: string; schema: unknown }): Promise<T> {
	const client = new OpenAI({ apiKey: params.apiKey });
	const response = await client.responses.create({
		model: params.model,
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

// --- provider-decision section ---
// Mirrors production: system prompt → candidates user step → context summary → tool call history

function buildProviderDecisionInput(params: {
	candidatesText: string;
	contextSummary: string;
	priorToolCalls?: Array<{
		callId: string;
		arguments: string;
		output: string;
		/** Assistant step appended after tool result when isSimilar=true (production: formatAgentEventForPrompt) */
		assistantFollowUp?: string;
	}>;
	laterContextSummary?: string;
}): OpenAI.Responses.ResponseInputItem[] {
	const items: OpenAI.Responses.ResponseInputItem[] = [{ role: "system", content: SIMILAR_PROVIDER_SYSTEM_PROMPT }];

	// Candidates loaded into context (matches production: ensureCandidatesLoaded)
	items.push({ role: "user", content: params.candidatesText });

	// Summarized context step (matches production: summarizeNewContext → one user step)
	items.push({ role: "user", content: params.contextSummary });

	// Prior tool calls + outputs + optional assistant follow-up (matches runSingleIteration + listModelInputItems)
	if (params.priorToolCalls) {
		for (const toolCall of params.priorToolCalls) {
			items.push({
				type: "function_call",
				call_id: toolCall.callId,
				name: "investigate_incident",
				arguments: toolCall.arguments,
			} as OpenAI.Responses.ResponseInputItem);
			items.push({
				type: "function_call_output",
				call_id: toolCall.callId,
				output: toolCall.output,
			});
			// Production appends an assistant step with formatAgentEventForPrompt when isSimilar=true
			if (toolCall.assistantFollowUp) {
				items.push({ role: "assistant", content: toolCall.assistantFollowUp });
			}
		}
	}

	// Later summarized context (matches production: second addContext batch → one user step)
	if (params.laterContextSummary) {
		items.push({ role: "user", content: params.laterContextSummary });
	}

	return items;
}

async function runProviderDecisionScenario(
	scenario: ProviderDecisionScenario,
	apiKey: string,
	model: string,
): Promise<{ ok: boolean; note: string; result: SimilarProviderDecision }> {
	const result = await decideSimilarProviderAction({ openaiApiKey: apiKey, input: scenario.input, model });
	const calledTool = result.toolCalls.length > 0;
	if (calledTool !== scenario.expectedCallsTool) {
		return { ok: false, note: `calledTool=${calledTool} expected=${scenario.expectedCallsTool}`, result };
	}
	if (calledTool && scenario.expectedIncidentIds) {
		const calledIds = result.toolCalls.map((tc) => tc.incidentId).sort();
		const badIds = calledIds.filter((id) => !scenario.expectedIncidentIds!.includes(id));
		if (badIds.length) {
			return { ok: false, note: `calledTool=true but unknown ids=[${badIds.join(",")}] expected_pool=[${scenario.expectedIncidentIds.join(",")}]`, result };
		}
	}
	const ids = calledTool ? result.toolCalls.map((tc) => tc.incidentId).join(",") : "none";
	return { ok: true, note: `calledTool=${calledTool} ids=[${ids}]`, result };
}

// --- deep-dive section ---

async function runDeepDiveScenario(scenario: DeepDiveScenario, apiKey: string, model: string): Promise<{ ok: boolean; note: string; result: DeepDiveDecision }> {
	const userPrompt = buildDeepDiveUserPrompt(scenario.input);

	const result = await callJsonSchema<DeepDiveDecision>({
		apiKey,
		model,
		systemPrompt: DEEP_DIVE_SYSTEM_PROMPT,
		userPrompt,
		schemaName: "similar_incident_deep_dive",
		schema: DEEP_DIVE_SCHEMA,
	});

	const ok = result.isSimilar === scenario.expectedSimilar;
	const note = `isSimilar=${String(result.isSimilar)} expected=${String(scenario.expectedSimilar)}`;
	return { ok, note, result };
}

// --- scenarios ---

function evt(id: number, event_type: AgentEvent["event_type"], event_data: AgentEvent["event_data"], created_at: string): AgentEvent {
	return { id, event_type, event_data, created_at, adapter: "slack", event_metadata: null };
}

function msgEvt(id: number, message: string, created_at: string): AgentEvent {
	return evt(id, "MESSAGE_ADDED", { message, userId: "U-oncall", messageId: `m-${id}` }, created_at);
}

// Shared candidate sets used across provider-decision scenarios
const DB_TIMEOUT_CANDIDATES = `Candidate incidents (2 open, 3 completed):
1. id=inc-prev-101 kind=completed status=resolved severity=high resolvedAt=2026-01-05T13:00:00.000Z title="API outage after pool config change" description="DB pool timeout errors after deploy; rollback plus pool reset mitigated quickly"
2. id=inc-prev-102 kind=completed status=resolved severity=low resolvedAt=2026-01-20T15:30:00.000Z title="Docs latency due cache miss" description="CDN cache-key issue on docs pages only"
3. id=inc-prev-103 kind=open status=mitigating severity=medium createdAt=2026-02-20T10:00:00.000Z title="Webhook retries delayed" description="Background webhook worker lag from queue shard imbalance"
4. id=inc-prev-104 kind=completed status=resolved severity=medium resolvedAt=2026-02-01T11:30:00.000Z title="Admin dashboard color regression" description="Internal admin page style issue after CSS bundle update"
5. id=inc-prev-105 kind=open status=open severity=low createdAt=2026-02-25T14:00:00.000Z title="Internal dashboard CSS issue" description="Admin panel layout regression after design token refactor"`;

const PROVIDER_DECISION_SCENARIOS: ProviderDecisionScenario[] = [
	{
		id: "provider-clear-context-first-run",
		name: "Clear operational context, first run, should call tool with relevant candidate",
		expectedCallsTool: true,
		expectedIncidentIds: ["inc-prev-101", "inc-prev-102", "inc-prev-103", "inc-prev-104", "inc-prev-105"],
		input: buildProviderDecisionInput({
			candidatesText: DB_TIMEOUT_CANDIDATES,
			contextSummary:
				"High-severity incident: API 5xx spike after deploy 1743. Error class is DB connection timeout across US and EU regions. Support confirms broad customer impact with failed checkout API calls.",
		}),
	},
	{
		id: "provider-no-material-change",
		name: "No material change since last run should NOT call tool",
		expectedCallsTool: false,
		input: buildProviderDecisionInput({
			candidatesText: DB_TIMEOUT_CANDIDATES,
			contextSummary:
				"High-severity incident: API 5xx spike after deploy 1743. Error class is DB connection timeout across US and EU regions. Support confirms broad customer impact with failed checkout API calls.",
			priorToolCalls: [
				{
					callId: "call_sim_1",
					arguments: JSON.stringify({ incidentId: "inc-prev-101", reason: "DB pool timeout errors after deploy — same error class as current incident" }),
					output: JSON.stringify({
						title: "API outage after pool config change",
						isSimilar: true,
						similarities: "Both incidents show DB connection timeout after deploy with broad customer impact.",
						learnings: "Rollback + pool reset mitigated in 3 minutes.",
					}),
					assistantFollowUp:
						'AGENT_SIMILAR_INCIDENT id=inc-prev-101 title="API outage after pool config change" similarities="Both incidents show DB connection timeout after deploy with broad customer impact." learnings="Rollback + pool reset mitigated in 3 minutes."',
				},
			],
			laterContextSummary:
				"Status moved to mitigating — rollback in progress. No new scope or root-cause updates. Monitoring only, waiting for confirmation from one customer segment.",
		}),
	},
	{
		id: "provider-material-change",
		name: "Material understanding shift should call tool with new or same candidates",
		expectedCallsTool: true,
		expectedIncidentIds: ["inc-prev-101", "inc-prev-102", "inc-prev-103", "inc-prev-104", "inc-prev-105"],
		input: buildProviderDecisionInput({
			candidatesText: DB_TIMEOUT_CANDIDATES,
			contextSummary: "High-severity incident: API 5xx spike after deploy 1743. Error class is DB connection timeout across US and EU regions.",
			priorToolCalls: [
				{
					callId: "call_sim_2",
					arguments: JSON.stringify({ incidentId: "inc-prev-101", reason: "DB pool timeout errors after deploy" }),
					output: JSON.stringify({
						title: "API outage after pool config change",
						isSimilar: false,
						similarities: "Both involve DB timeouts after deploy, but current incident is still being diagnosed.",
					}),
				},
			],
			laterContextSummary:
				"Root cause shifted: connection pool exhaustion caused by config drift in sidecar, not the deploy itself. Mitigation changed from rollback to emergency pool size override.",
		}),
	},
];

const DEEP_DIVE_SCENARIOS: DeepDiveScenario[] = [
	{
		id: "deep-dive-true-positive",
		name: "Deep dive confirms strong API timeout similarity",
		expectedSimilar: true,
		input: {
			incident: {
				id: "inc-deep-1",
				title: "API timeout spike after deploy",
				description: "DB timeout 5xx impacting checkout and account APIs",
				status: "open",
				severity: "high",
			},
			contextSnapshot: "Deploy likely introduced DB pool exhaustion and timeout cascade.",
			candidate: {
				id: "inc-prev-301",
				kind: "completed",
				title: "API timeout incident after pool config rollout",
				description: "Pool exhaustion caused DB timeout 5xx within minutes of deploy",
				status: "resolved",
				severity: "high",
				createdAt: "2026-01-03T10:00:00.000Z",
				resolvedAt: "2026-01-03T11:00:00.000Z",
				prompt: "API timeout incident triggered after pool configuration rollout to production.",
				rootCause: "Connection pool max_connections reduced by config change, causing exhaustion under normal load.",
				impact: "Checkout and account APIs returned 5xx for ~45 minutes affecting enterprise customers.",
				eventsSummary:
					"[10:00] INCIDENT_CREATED: API errors rising\n[10:02] MESSAGE_ADDED: timeout class isolated to DB pool\n[10:05] STATUS_UPDATE: rollback+pool reset reduced errors from 28% to <1%",
			},
		},
	},
	{
		id: "deep-dive-true-negative-unrelated",
		name: "Deep dive rejects unrelated internal UI incident",
		expectedSimilar: false,
		input: {
			incident: {
				id: "inc-deep-2",
				title: "API timeout spike after deploy",
				description: "DB timeout 5xx impacting external customers",
				status: "open",
				severity: "high",
			},
			contextSnapshot: "Likely backend capacity/regression issue in request path.",
			candidate: {
				id: "inc-prev-302",
				kind: "completed",
				title: "Admin dashboard color regression",
				description: "Internal admin page style issue after CSS bundle update",
				status: "resolved",
				severity: "low",
				createdAt: "2026-02-01T11:00:00.000Z",
				resolvedAt: "2026-02-01T11:30:00.000Z",
				prompt: "Admin dashboard color regression reported after CSS bundle update.",
				rootCause: "CSS variable override missing in dark-mode theme after design-token migration.",
				impact: "Internal admin users saw incorrect colors on dashboard widgets for 30 minutes.",
				eventsSummary: "[11:00] INCIDENT_CREATED: internal styling issue\n[11:03] STATUS_UPDATE: resolved after CSS rollback",
			},
		},
	},
	{
		id: "deep-dive-true-negative-surface",
		name: "Deep dive rejects weak similarity with same symptom but different mechanism",
		expectedSimilar: false,
		input: {
			incident: {
				id: "inc-deep-3",
				title: "Event pipeline lag after schema registry instability",
				description: "Consumer lag and timeout causing delayed order updates",
				status: "mitigating",
				severity: "high",
			},
			contextSnapshot: "Registry latency triggered rebalance and decode failures.",
			candidate: {
				id: "inc-prev-303",
				kind: "completed",
				title: "Event pipeline lag from batch job backlog",
				description: "Nightly ETL saturation delayed downstream consumers",
				status: "resolved",
				severity: "medium",
				createdAt: "2026-01-08T09:00:00.000Z",
				resolvedAt: "2026-01-08T09:45:00.000Z",
				prompt: "Event pipeline lag observed due to batch job backlog saturating consumer throughput.",
				rootCause: "Nightly ETL backfill flooded shared Kafka topic, starving real-time consumers of partition throughput.",
				impact: "Order-state events delayed by 25 minutes for all downstream consumers during backfill window.",
				eventsSummary: "[09:00] INCIDENT_CREATED: lag observed\n[09:05] MESSAGE_ADDED: root cause ETL backfill flood\n[09:30] STATUS_UPDATE: resolved after backfill pause",
			},
		},
	},
	{
		id: "deep-dive-true-positive-mechanism",
		name: "Deep dive confirms meaningful Kafka similarity",
		expectedSimilar: true,
		input: {
			incident: {
				id: "inc-deep-4",
				title: "Event pipeline lag after schema registry instability",
				description: "Consumer rebalance storm and timeout in order event stream",
				status: "mitigating",
				severity: "high",
			},
			contextSnapshot: "Schema registry latency and token churn caused repeated rebalances.",
			candidate: {
				id: "inc-prev-304",
				kind: "completed",
				title: "Kafka consumer lag from auth token churn",
				description: "Token expiry triggered rebalance loop and event backlog",
				status: "resolved",
				severity: "high",
				createdAt: "2026-01-18T08:00:00.000Z",
				resolvedAt: "2026-01-18T08:45:00.000Z",
				prompt: "Kafka consumer lag incident triggered by auth token churn causing rebalance loop.",
				rootCause: "Short-lived auth tokens triggered frequent consumer group rebalances, each causing event processing pauses.",
				impact: "Order event backlog grew to 12 minutes, delaying downstream fulfillment and notification services.",
				eventsSummary:
					"[08:10] INCIDENT_CREATED: order events delayed\n[08:15] MESSAGE_ADDED: auth token refresh failures causing rebalance\n[08:22] STATUS_UPDATE: mitigating after token TTL fix",
			},
		},
	},
];

// --- summarization section ---
// Replicates the event formatting from base.ts summarizeNewContext

function formatEventsForSummarization(events: AgentEvent[]): string {
	return events
		.map((event) => {
			const ts = event.created_at;
			if (isInternalAgentEvent(event)) {
				return `[${ts}] ${formatAgentEventForPrompt(event)}`;
			}
			return `[${ts}] ${event.event_type}: ${JSON.stringify(normalizeEventData(event.event_data))}`;
		})
		.join("\n");
}

async function runSummarizationScenario(scenario: SummarizationScenario, apiKey: string, model: string): Promise<{ ok: boolean; note: string; result: SummarizationResult }> {
	const formatted = formatEventsForSummarization(scenario.events);
	const existingInput: OpenAI.Responses.ResponseInputItem[] = scenario.existingInput ?? [{ role: "system", content: SIMILAR_PROVIDER_SYSTEM_PROMPT }];
	const input: OpenAI.Responses.ResponseInputItem[] = [
		...existingInput,
		{ role: "user", content: `New incident events:\n${formatted}\n\n${SIMILAR_PROVIDER_SUMMARIZATION_PROMPT}` },
	];

	const client = new OpenAI({ apiKey });
	const response = await client.responses.create({
		model,
		input,
		text: { verbosity: "low" },
	});

	const text = response.output_text.trim();
	const summary = !text || text === "SKIP" ? null : text;

	if (scenario.expectSkip) {
		const ok = summary === null;
		return {
			ok,
			note: `expectSkip=true got=${summary === null ? "SKIP" : `"${summary.slice(0, 80)}..."`}`,
			result: { summary },
		};
	}

	if (summary === null) {
		return {
			ok: false,
			note: "expectSkip=false but got SKIP",
			result: { summary },
		};
	}

	const signals = scenario.expectedSignals ?? [];
	const lower = summary.toLowerCase();
	const missing = signals.filter((s) => !lower.includes(s.toLowerCase()));
	const ok = missing.length === 0;
	return {
		ok,
		note: `summary="${summary.slice(0, 120)}${summary.length > 120 ? "..." : ""}"${missing.length ? ` missing_signals=[${missing.join(",")}]` : ""}`,
		result: { summary },
	};
}

const SUMMARIZATION_SCENARIOS: SummarizationScenario[] = [
	{
		id: "summarization-technical-signals",
		name: "Clear technical events produce summary with key signals",
		expectSkip: false,
		expectedSignals: ["deploy", "timeout"],
		events: [
			evt(
				1,
				"INCIDENT_CREATED",
				{ title: "API 5xx spike after deploy", description: "Timeout errors after rollout", severity: "high", status: "open" },
				"2026-02-27T10:00:00.000Z",
			),
			msgEvt(2, "Deploy 1743 completed 2 minutes before errors started.", "2026-02-27T10:03:00.000Z"),
			msgEvt(3, "Error class is DB connection timeout across US+EU regions.", "2026-02-27T10:04:00.000Z"),
			msgEvt(4, "Support confirms broad customer impact and failed checkout API calls.", "2026-02-27T10:05:00.000Z"),
		],
	},
	{
		id: "summarization-skip-chatter",
		name: "Monitoring chatter with no new signal produces SKIP",
		expectSkip: true,
		events: [
			msgEvt(5, "Still monitoring. No change.", "2026-02-27T10:11:00.000Z"),
			msgEvt(6, "Same errors, waiting for rollback to complete.", "2026-02-27T10:12:00.000Z"),
			msgEvt(7, "No update from customer support yet.", "2026-02-27T10:13:00.000Z"),
		],
		existingInput: [
			{ role: "system", content: SIMILAR_PROVIDER_SYSTEM_PROMPT },
			{
				role: "user",
				content: "High-severity incident: API 5xx spike after deploy 1743. DB connection timeout errors across US+EU. Broad customer impact confirmed.",
			},
		],
	},
	{
		id: "summarization-root-cause-shift",
		name: "Root cause shift produces summary with new mechanism",
		expectSkip: false,
		expectedSignals: ["pool", "config"],
		events: [
			msgEvt(4, "Root cause identified: connection pool exhaustion from config drift in sidecar proxy.", "2026-02-27T10:15:00.000Z"),
			msgEvt(5, "Switched mitigation from deploy rollback to emergency pool size override.", "2026-02-27T10:16:00.000Z"),
		],
		existingInput: [
			{ role: "system", content: SIMILAR_PROVIDER_SYSTEM_PROMPT },
			{
				role: "user",
				content: "High-severity incident: API 5xx spike after deploy 1743. DB connection timeout across US+EU regions.",
			},
		],
	},
];

// --- CLI + runner ---

function toSafePath(path: string): string {
	return resolve(path);
}

async function maybeWriteSummary(pathArg: string | undefined, summary: EvalSummary) {
	if (!pathArg) {
		return;
	}
	const outPath = toSafePath(pathArg);
	await mkdir(dirname(outPath), { recursive: true });
	await writeFile(outPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
	console.log(`Wrote summary: ${outPath}`);
}

function readArgValue(name: string): string | undefined {
	const match = process.argv.find((arg) => arg.startsWith(`--${name}=`));
	return match ? match.slice(name.length + 3) : undefined;
}

function parseSection(value: string | undefined): EvalSection {
	if (!value) {
		return "all";
	}
	if (value === "all" || value === "provider-decision" || value === "deep-dive" || value === "summarization") {
		return value;
	}
	throw new Error(`Invalid --section value "${value}". Use all|provider-decision|deep-dive|summarization.`);
}

async function main() {
	const apiKey = process.env.OPENAI_API_KEY;
	if (!apiKey) {
		throw new Error("OPENAI_API_KEY is required");
	}

	const model = readArgValue("model") ?? "gpt-5.2";
	const runsRaw = readArgValue("runs") ?? "1";
	const runs = Number.parseInt(runsRaw, 10);
	if (!Number.isFinite(runs) || runs < 1) {
		throw new Error(`Invalid --runs value "${runsRaw}". Use a positive integer.`);
	}
	const section = parseSection(readArgValue("section"));
	const outPath = readArgValue("out");

	console.log(`Running similar-incident eval suite (model=${model}, section=${section}, runs=${runs})`);

	const scenarioRuns: ScenarioRunResult[] = [];

	const runProviderDecision = section === "all" || section === "provider-decision";
	if (runProviderDecision) {
		for (const scenario of PROVIDER_DECISION_SCENARIOS) {
			for (let runIndex = 1; runIndex <= runs; runIndex += 1) {
				const { ok, note, result } = await runProviderDecisionScenario(scenario, apiKey, model);
				scenarioRuns.push({
					section: "provider-decision",
					scenarioId: scenario.id,
					scenarioName: scenario.name,
					runIndex,
					ok,
					note,
					raw: result,
				});
				console.log(`[provider-decision] ${scenario.id} run=${runIndex} -> ${ok ? "PASS" : "FAIL"} (${note})`);
			}
		}
	}

	const runDeepDive = section === "all" || section === "deep-dive";
	if (runDeepDive) {
		for (const scenario of DEEP_DIVE_SCENARIOS) {
			for (let runIndex = 1; runIndex <= runs; runIndex += 1) {
				const { ok, note, result } = await runDeepDiveScenario(scenario, apiKey, model);
				scenarioRuns.push({
					section: "deep-dive",
					scenarioId: scenario.id,
					scenarioName: scenario.name,
					runIndex,
					ok,
					note,
					raw: result,
				});
				console.log(`[deep-dive] ${scenario.id} run=${runIndex} -> ${ok ? "PASS" : "FAIL"} (${note})`);
			}
		}
	}

	const runSummarization = section === "all" || section === "summarization";
	if (runSummarization) {
		for (const scenario of SUMMARIZATION_SCENARIOS) {
			for (let runIndex = 1; runIndex <= runs; runIndex += 1) {
				const { ok, note, result } = await runSummarizationScenario(scenario, apiKey, model);
				scenarioRuns.push({
					section: "summarization",
					scenarioId: scenario.id,
					scenarioName: scenario.name,
					runIndex,
					ok,
					note,
					raw: result,
				});
				console.log(`[summarization] ${scenario.id} run=${runIndex} -> ${ok ? "PASS" : "FAIL"} (${note})`);
			}
		}
	}

	const bySection = {
		"provider-decision": { scenarioRuns: 0, passes: 0, fails: 0, passRate: 0 },
		"deep-dive": { scenarioRuns: 0, passes: 0, fails: 0, passRate: 0 },
		summarization: { scenarioRuns: 0, passes: 0, fails: 0, passRate: 0 },
	};

	for (const result of scenarioRuns) {
		const bucket = bySection[result.section];
		bucket.scenarioRuns += 1;
		if (result.ok) {
			bucket.passes += 1;
		} else {
			bucket.fails += 1;
		}
	}
	for (const bucket of Object.values(bySection)) {
		bucket.passRate = bucket.scenarioRuns ? bucket.passes / bucket.scenarioRuns : 0;
	}

	const totals = {
		scenarioRuns: scenarioRuns.length,
		passes: scenarioRuns.filter((result) => result.ok).length,
		fails: scenarioRuns.filter((result) => !result.ok).length,
		passRate: scenarioRuns.length ? scenarioRuns.filter((result) => result.ok).length / scenarioRuns.length : 0,
	};

	const summary: EvalSummary = {
		createdAt: new Date().toISOString(),
		model,
		section,
		runsPerScenario: runs,
		totals,
		bySection,
		results: scenarioRuns,
	};

	await maybeWriteSummary(outPath, summary);

	console.log("\nSummary:");
	console.log(`- total runs: ${totals.scenarioRuns}`);
	console.log(`- pass: ${totals.passes}`);
	console.log(`- fail: ${totals.fails}`);
	console.log(`- pass rate: ${(totals.passRate * 100).toFixed(1)}%`);
	console.log(`- provider-decision pass rate: ${(bySection["provider-decision"].passRate * 100).toFixed(1)}%`);
	console.log(`- deep-dive pass rate: ${(bySection["deep-dive"].passRate * 100).toFixed(1)}%`);
	console.log(`- summarization pass rate: ${(bySection.summarization.passRate * 100).toFixed(1)}%`);

	if (totals.fails > 0) {
		throw new Error(`similar-incident eval failed: ${totals.fails} failed scenario run(s)`);
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
