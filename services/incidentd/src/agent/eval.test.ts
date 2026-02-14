/**
 * Evaluation harness for the incident management AI agent.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... npx tsx services/incidentd/src/agent/eval.test.ts
 *   OPENAI_API_KEY=sk-... npx tsx services/incidentd/src/agent/eval.test.ts --scenario=web
 *   OPENAI_API_KEY=sk-... npx tsx services/incidentd/src/agent/eval.test.ts --runs=3 --verbose
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
	buildContextUserMessage,
	buildEventMessages,
	buildIncidentStateMessage,
	buildStatusPageContextMessage,
	buildSuggestionStateContextMessage,
	buildSuggestionTools,
	normalizeSuggestions,
	SYSTEM_PROMPT,
	toResponsesTools,
} from "./suggestions";
import type { AgentEvent, AgentSuggestion, AgentSuggestionContext } from "./types";

// ---------------------------------------------------------------------------
// Message builder
// ---------------------------------------------------------------------------

type InputMessage = { type: "message"; role: "system" | "user" | "assistant"; content: string };

function buildFullInput(context: AgentSuggestionContext, opts: { systemPrompt?: string }): InputMessage[] {
	const systemPrompt = opts.systemPrompt ?? SYSTEM_PROMPT;
	const userMessage = buildContextUserMessage(context);
	const statusPageContextMessage = buildStatusPageContextMessage(context);
	const suggestionStateContextMessage = buildSuggestionStateContextMessage(context);
	const incidentStateMessage = buildIncidentStateMessage(context);
	const eventMessages = buildEventMessages(context.events, context.processedThroughId ?? 0);

	const raw: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
		{ role: "system", content: systemPrompt },
		{ role: "user", content: userMessage },
		...eventMessages,
		{ role: "user", content: statusPageContextMessage },
		{ role: "user", content: suggestionStateContextMessage },
		{ role: "user", content: incidentStateMessage },
		{ role: "user", content: "Return suggestions." },
	];

	return raw.map((m) => ({ type: "message" as const, role: m.role, content: m.content }));
}

// ---------------------------------------------------------------------------
// OpenAI Responses API caller
// ---------------------------------------------------------------------------

type ResponseFunctionCallItem = { type?: string; name?: string; arguments?: string };
type ResponsesCreateResponse = {
	id?: string;
	output?: ResponseFunctionCallItem[];
	usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
};

type ResponsesToolDef = { type: "function"; name: string; description: string; parameters: unknown };

type ModelUsage = { inputTokens: number; outputTokens: number; cachedInputTokens: number; totalTokens: number };
type ModelToolCall = { name: string; args: Record<string, unknown> };
type ModelCallResult = { responseId?: string; usage?: ModelUsage; toolCalls: ModelToolCall[]; suggestions: AgentSuggestion[] };

type ReasoningEffort = "low" | "medium" | "high";

async function callOpenAI(input: InputMessage[], tools: ResponsesToolDef[], apiKey: string, model: string, reasoningEffort: ReasoningEffort): Promise<ModelCallResult> {
	const suggestions: AgentSuggestion[] = [];

	const response = await fetch("https://api.openai.com/v1/responses", {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
		body: JSON.stringify({
			model,
			input,
			tools,
			tool_choice: "auto",
			reasoning: { effort: reasoningEffort },
			text: { verbosity: "low" },
		}),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`OpenAI API error ${response.status}: ${text}`);
	}

	const data = (await response.json()) as ResponsesCreateResponse;
	if (data.usage) {
		const cached = data.usage.input_tokens_details?.cached_tokens ?? 0;
		console.log(`    [usage] input=${data.usage.input_tokens} (cached=${cached}) output=${data.usage.output_tokens}`);
	}

	const parsedToolCalls: ModelToolCall[] = [];
	const toolCalls = (data.output ?? []).filter(
		(item): item is Required<Pick<ResponseFunctionCallItem, "name">> & ResponseFunctionCallItem => item.type === "function_call" && typeof item.name === "string",
	);

	for (const call of toolCalls) {
		let args: Record<string, unknown> = {};
		if (call.arguments) {
			try {
				args = JSON.parse(call.arguments) as Record<string, unknown>;
			} catch {
				args = {};
			}
		}
		parsedToolCalls.push({ name: call.name, args });
		switch (call.name) {
			case "update_status":
				if (typeof args.evidence === "string" && args.evidence.trim() && typeof args.status === "string" && typeof args.message === "string") {
					suggestions.push({ action: "update_status", status: args.status as "mitigating" | "resolved", message: args.message });
				}
				break;
			case "update_severity":
				if (typeof args.evidence === "string" && args.evidence.trim() && typeof args.severity === "string") {
					suggestions.push({ action: "update_severity", severity: args.severity as "low" | "medium" | "high" });
				}
				break;
			case "add_status_page_update":
				if (typeof args.evidence === "string" && args.evidence.trim() && typeof args.message === "string") {
					suggestions.push({
						action: "add_status_page_update",
						message: args.message,
						...(typeof args.affectionStatus === "string" ? { affectionStatus: args.affectionStatus as "investigating" | "mitigating" | "resolved" } : {}),
						...(typeof args.title === "string" ? { title: args.title } : {}),
						...(Array.isArray(args.services) ? { services: args.services as { id: string; impact: "partial" | "major" }[] } : {}),
					});
				}
				break;
		}
	}

	const usage = data.usage
		? {
				inputTokens: data.usage.input_tokens ?? 0,
				outputTokens: data.usage.output_tokens ?? 0,
				cachedInputTokens: data.usage.input_tokens_details?.cached_tokens ?? 0,
				totalTokens: data.usage.total_tokens ?? 0,
			}
		: undefined;

	return { responseId: data.id, usage, toolCalls: parsedToolCalls, suggestions };
}

// ---------------------------------------------------------------------------
// Lifecycle scenario types
// ---------------------------------------------------------------------------

type ExpectationCheck = string;

type Turn = {
	name: string;
	context: AgentSuggestionContext;
	checks: ExpectationCheck[];
};

type LifecycleScenario = {
	id: string;
	name: string;
	description: string;
	turns: Turn[];
};

// ---------------------------------------------------------------------------
// Event + incident helpers
// ---------------------------------------------------------------------------

const BASE_TIME = new Date("2026-02-07T10:00:00Z");

function ts(minutesAfterBase: number): string {
	return new Date(BASE_TIME.getTime() + minutesAfterBase * 60_000).toISOString();
}

let _nextEventId = 1;
function nextId(): number {
	return _nextEventId++;
}
function resetIds(): void {
	_nextEventId = 1;
}

// Eval uses loose event_data for test fixtures — cast to satisfy strict production types
function mkEvent(
	overrides: { event_type: AgentEvent["event_type"]; event_data: Record<string, unknown> } & {
		id?: number;
		created_at?: string;
		adapter?: AgentEvent["adapter"];
		event_metadata?: Record<string, string> | null;
	},
	minutesAfterBase: number,
): AgentEvent {
	return {
		id: overrides.id ?? nextId(),
		event_type: overrides.event_type,
		event_data: overrides.event_data as AgentEvent["event_data"],
		created_at: overrides.created_at ?? ts(minutesAfterBase),
		adapter: overrides.adapter ?? "slack",
		event_metadata: overrides.event_metadata ?? null,
	};
}

function mkSuggestionEvent(suggestion: Record<string, unknown>, minutesAfterBase: number, suggestionId: string): AgentEvent {
	return mkEvent(
		{
			event_type: "MESSAGE_ADDED",
			event_data: { message: JSON.stringify(suggestion), userId: "fire", suggestion },
			adapter: "fire",
			event_metadata: { kind: "suggestion", agentSuggestionId: suggestionId },
		},
		minutesAfterBase,
	);
}

function baseIncident(overrides?: Partial<AgentSuggestionContext["incident"]>): AgentSuggestionContext["incident"] {
	return {
		id: "inc_eval_lifecycle_001_aaaa",
		status: "open",
		severity: "medium",
		title: "Untitled incident",
		description: "",
		prompt: "",
		assignee: "U_ONCALL",
		source: "slack",
		createdAt: ts(0),
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Check helpers
// ---------------------------------------------------------------------------

function shouldNotSuggest(action: string, extraMatch?: (s: AgentSuggestion) => boolean): ExpectationCheck {
	const detail = extractExpectationDetail(extraMatch);
	return detail ? `Should NOT suggest ${action} (${detail}).` : `Should NOT suggest ${action}.`;
}

function shouldSuggest(action: string, extraMatch?: (s: AgentSuggestion) => boolean): ExpectationCheck {
	const detail = extractExpectationDetail(extraMatch);
	return detail ? `Should suggest ${action} (${detail}).` : `Should suggest ${action}.`;
}

function extractExpectationDetail(extraMatch?: (s: AgentSuggestion) => boolean): string | null {
	if (!extraMatch) {
		return null;
	}
	const source = extraMatch.toString();
	const details: string[] = [];
	const unique = (values: string[]) => [...new Set(values)];
	const captureAll = (regex: RegExp) => unique(Array.from(source.matchAll(regex), (m) => m[1]!).filter(Boolean));
	const statuses = captureAll(/\bstatus\s*===\s*"([^"]+)"/g);
	const severities = captureAll(/\bseverity\s*===\s*"([^"]+)"/g);
	const affectionStatuses = captureAll(/\baffectionStatus\s*===\s*"([^"]+)"/g);

	if (statuses.length === 1) {
		details.push(`status=${statuses[0]}`);
	} else if (statuses.length > 1) {
		details.push(`status in [${statuses.join(", ")}]`);
	}
	if (severities.length === 1) {
		details.push(`severity=${severities[0]}`);
	} else if (severities.length > 1) {
		details.push(`severity in [${severities.join(", ")}]`);
	}
	if (affectionStatuses.length === 1) {
		details.push(`affectionStatus=${affectionStatuses[0]}`);
	} else if (affectionStatuses.length > 1) {
		details.push(`affectionStatus in [${affectionStatuses.join(", ")}]`);
	}

	if (!details.length) {
		return "matching scenario-specific constraint";
	}
	return details.join(", ");
}

// ---------------------------------------------------------------------------
// Scenario 1: Web Incident — CDN Outage
// ---------------------------------------------------------------------------

function buildWebIncidentScenario(): LifecycleScenario {
	const SERVICES: AgentSuggestionContext["services"] = [
		{ id: "svc_web", name: "Web Application", prompt: "Customer-facing web application (app.example.com)" },
		{ id: "svc_api", name: "REST API", prompt: "Public REST API for integrations (api.example.com)" },
		{ id: "svc_admin", name: "Admin Dashboard", prompt: "Internal admin dashboard for account management" },
		{ id: "svc_workers", name: "Background Workers", prompt: "Async job processing (emails, reports, data sync)" },
		{ id: "svc_docs", name: "Documentation", prompt: "Public documentation site (docs.example.com)" },
	];

	const incidentBase = {
		title: "Website returning 503 errors",
		description: "Users in multiple regions reporting website is down with 503 errors",
		prompt: "Investigate website outage",
	};

	// -- Turn 1: Initial alert, no action taken yet --
	resetIds();
	const t1Events: AgentEvent[] = [
		mkEvent(
			{
				event_type: "INCIDENT_CREATED",
				event_data: {
					status: "open",
					severity: "medium",
					createdBy: "U_ONCALL",
					...incidentBase,
					source: "slack",
					assignee: "U_ONCALL",
					entryPointId: "ep_1",
					rotationId: "rot_1",
				},
			},
			0,
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Getting reports that the website is returning 503 errors for static assets", userId: "U_ALICE" } }, 2),
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: { message: "CDN health check failing in EU and US-West regions. Confirmed — users in affected regions cannot load any pages.", userId: "U_ALICE" },
			},
			4,
		),
		mkEvent(
			{ event_type: "MESSAGE_ADDED", event_data: { message: "Multiple customers have opened support tickets. This is a complete outage for EU users.", userId: "U_BOB" } },
			5,
		),
	];

	// -- Turn 2: Root cause found, rollback deployed --
	resetIds();
	const t2Events: AgentEvent[] = [
		mkEvent(
			{
				event_type: "INCIDENT_CREATED",
				event_data: {
					status: "open",
					severity: "medium",
					createdBy: "U_ONCALL",
					...incidentBase,
					source: "slack",
					assignee: "U_ONCALL",
					entryPointId: "ep_1",
					rotationId: "rot_1",
				},
			},
			0,
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Getting reports that the website is returning 503 errors for static assets", userId: "U_ALICE" } }, 2),
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: { message: "CDN health check failing in EU and US-West regions. Confirmed — users in affected regions cannot load any pages.", userId: "U_ALICE" },
			},
			4,
		),
		mkEvent(
			{ event_type: "MESSAGE_ADDED", event_data: { message: "Multiple customers have opened support tickets. This is a complete outage for EU users.", userId: "U_BOB" } },
			5,
		),
		mkEvent({ event_type: "SEVERITY_UPDATE", event_data: { severity: "high" } }, 6),
		mkEvent({ event_type: "AFFECTION_UPDATE", event_data: { status: "investigating", title: "Website outage", services: [{ id: "svc_web", impact: "major" }] } }, 7),
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: { message: "Found the issue — CDN config update pushed an invalid origin address during scheduled maintenance.", userId: "U_ALICE" },
			},
			10,
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Rolled back the CDN config change to the previous version.", userId: "U_ALICE" } }, 12),
	];

	// -- Turn 3: Partial recovery, monitoring (with prior mitigating suggestion) --
	resetIds();
	const t3Events: AgentEvent[] = [
		mkEvent(
			{
				event_type: "INCIDENT_CREATED",
				event_data: {
					status: "open",
					severity: "medium",
					createdBy: "U_ONCALL",
					...incidentBase,
					source: "slack",
					assignee: "U_ONCALL",
					entryPointId: "ep_1",
					rotationId: "rot_1",
				},
			},
			0,
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Getting reports that the website is returning 503 errors for static assets", userId: "U_ALICE" } }, 2),
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: { message: "CDN health check failing in EU and US-West regions. Confirmed — users in affected regions cannot load any pages.", userId: "U_ALICE" },
			},
			4,
		),
		mkEvent(
			{ event_type: "MESSAGE_ADDED", event_data: { message: "Multiple customers have opened support tickets. This is a complete outage for EU users.", userId: "U_BOB" } },
			5,
		),
		mkEvent({ event_type: "SEVERITY_UPDATE", event_data: { severity: "high" } }, 6),
		mkEvent({ event_type: "AFFECTION_UPDATE", event_data: { status: "investigating", title: "Website outage", services: [{ id: "svc_web", impact: "major" }] } }, 7),
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: { message: "Found the issue — CDN config update pushed an invalid origin address during scheduled maintenance.", userId: "U_ALICE" },
			},
			10,
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Rolled back the CDN config change to the previous version.", userId: "U_ALICE" } }, 12),
		// Agent suggested mitigating — dispatcher applied it
		mkSuggestionEvent({ action: "update_status", status: "mitigating", message: "CDN config rolled back to previous version" }, 13, "sug_w_1"),
		mkEvent({ event_type: "STATUS_UPDATE", event_data: { status: "mitigating", message: "CDN config rolled back to previous version" } }, 14),
		mkEvent({ event_type: "AFFECTION_UPDATE", event_data: { status: "mitigating" } }, 14),
		// New events after the suggestion
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: { message: "Cache is still stale in some edge locations. US-East recovered, EU still showing 503s for some assets.", userId: "U_ALICE" },
			},
			18,
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Purging CDN cache for affected regions now.", userId: "U_ALICE" } }, 20),
	];
	const t3ProcessedThrough = t3Events[10]!.id; // processed through the AFFECTION_UPDATE mitigating

	// -- Turn 4: Fully recovered, confirmed --
	resetIds();
	const t4Events: AgentEvent[] = [
		...t3Events.slice(0, -2).map((e, i) => ({ ...e, id: i + 1 })), // re-index
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: { message: "Cache is still stale in some edge locations. US-East recovered, EU still showing 503s for some assets.", userId: "U_ALICE" },
			},
			18,
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Purging CDN cache for affected regions now.", userId: "U_ALICE" } }, 20),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Cache purge complete. All regions showing 200 responses.", userId: "U_ALICE" } }, 30),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Confirmed working — error rate at 0% across all regions. Website fully operational.", userId: "U_BOB" } }, 35),
	];
	const t4ProcessedThrough = t4Events[12]!.id;

	return {
		id: "web",
		name: "Web Incident: CDN Outage",
		description: "Website returning 503s due to invalid CDN config. Rollback, cache purge, full recovery.",
		turns: [
			{
				name: "Turn 1: Initial alert — no action taken",
				context: {
					incident: baseIncident(incidentBase),
					services: SERVICES,
					affection: { hasAffection: false },
					events: t1Events,
					processedThroughId: 0,
					validStatusTransitions: ["mitigating", "resolved"],
				},
				checks: [
					shouldNotSuggest("update_status", (s) => s.action === "update_status" && s.status === "mitigating"),
					shouldNotSuggest("update_status", (s) => s.action === "update_status" && s.status === "resolved"),
					shouldSuggest("add_status_page_update", (s) => s.action === "add_status_page_update" && s.affectionStatus === "investigating"),
				],
			},
			{
				name: "Turn 2: Rollback deployed — should suggest mitigating",
				context: {
					incident: baseIncident({ ...incidentBase, severity: "high" }),
					services: SERVICES,
					affection: { hasAffection: true, lastStatus: "investigating" },
					events: t2Events,
					processedThroughId: 0,
					validStatusTransitions: ["mitigating", "resolved"],
				},
				checks: [
					shouldSuggest("update_status", (s) => s.action === "update_status" && s.status === "mitigating"),
					shouldNotSuggest("update_status", (s) => s.action === "update_status" && s.status === "resolved"),
				],
			},
			{
				name: "Turn 3: Partial recovery — no resolved, no re-suggest mitigating",
				context: {
					incident: baseIncident({ ...incidentBase, status: "mitigating", severity: "high" }),
					services: SERVICES,
					affection: { hasAffection: true, lastStatus: "mitigating" },
					events: t3Events,
					processedThroughId: t3ProcessedThrough,
					validStatusTransitions: ["resolved"],
				},
				checks: [shouldNotSuggest("update_status", (s) => s.action === "update_status" && s.status === "resolved")],
			},
			{
				name: "Turn 4: Confirmed fixed — should suggest resolved",
				context: {
					incident: baseIncident({ ...incidentBase, status: "mitigating", severity: "high" }),
					services: SERVICES,
					affection: { hasAffection: true, lastStatus: "mitigating" },
					events: t4Events,
					processedThroughId: t4ProcessedThrough,
					validStatusTransitions: ["resolved"],
				},
				checks: [shouldSuggest("update_status", (s) => s.action === "update_status" && s.status === "resolved")],
			},
		],
	};
}

// ---------------------------------------------------------------------------
// Scenario 2: API Incident — Payment Processing Failures
// ---------------------------------------------------------------------------

function buildApiIncidentScenario(): LifecycleScenario {
	const SERVICES: AgentSuggestionContext["services"] = [
		{ id: "svc_web", name: "Web Application", prompt: "Customer-facing web application (app.example.com)" },
		{ id: "svc_api", name: "REST API", prompt: "Public REST API for integrations (api.example.com)" },
		{ id: "svc_admin", name: "Admin Dashboard", prompt: "Internal admin dashboard for account management" },
		{ id: "svc_workers", name: "Background Workers", prompt: "Async job processing (emails, reports, data sync)" },
		{ id: "svc_docs", name: "Documentation", prompt: "Public documentation site (docs.example.com)" },
	];

	const incidentBase = {
		title: "Payment processing failures — 500 errors on /api/v2/payments",
		description: "Customers unable to complete purchases, 500 error rate >10%",
		prompt: "Investigate payment processing failures",
	};

	// -- Turn 1: Alert fires, investigating --
	resetIds();
	const t1Events: AgentEvent[] = [
		mkEvent(
			{
				event_type: "INCIDENT_CREATED",
				event_data: {
					status: "open",
					severity: "medium",
					createdBy: "U_ONCALL",
					...incidentBase,
					source: "slack",
					assignee: "U_ONCALL",
					entryPointId: "ep_1",
					rotationId: "rot_1",
				},
			},
			0,
		),
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: { message: "PagerDuty alert: 500 error rate >10% on /api/v2/payments. Customers unable to complete purchases.", userId: "U_ALICE" },
			},
			1,
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Confirmed — payment failures affecting all customers. Revenue impacted.", userId: "U_BOB" } }, 3),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Looking into the payment service logs now.", userId: "U_ALICE" } }, 5),
	];

	// -- Turn 2: Root cause found, hotfix deployed --
	resetIds();
	const t2Events: AgentEvent[] = [
		mkEvent(
			{
				event_type: "INCIDENT_CREATED",
				event_data: {
					status: "open",
					severity: "medium",
					createdBy: "U_ONCALL",
					...incidentBase,
					source: "slack",
					assignee: "U_ONCALL",
					entryPointId: "ep_1",
					rotationId: "rot_1",
				},
			},
			0,
		),
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: { message: "PagerDuty alert: 500 error rate >10% on /api/v2/payments. Customers unable to complete purchases.", userId: "U_ALICE" },
			},
			1,
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Confirmed — payment failures affecting all customers. Revenue impacted.", userId: "U_BOB" } }, 3),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Looking into the payment service logs now.", userId: "U_ALICE" } }, 5),
		mkEvent({ event_type: "SEVERITY_UPDATE", event_data: { severity: "high" } }, 6),
		// Agent previously suggested severity high — dispatcher applied it
		mkSuggestionEvent({ action: "update_severity", severity: "high" }, 6, "sug_a_1"),
		mkEvent({ event_type: "AFFECTION_UPDATE", event_data: { status: "investigating", title: "Payment processing failures", services: [{ id: "svc_api", impact: "major" }] } }, 7),
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: { message: "Root cause identified — DB connection pool exhausted after latest deploy introduced N+1 queries on payment validation.", userId: "U_ALICE" },
			},
			10,
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Deploying hotfix to revert the problematic query pattern.", userId: "U_ALICE" } }, 12),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Hotfix deployed to all instances.", userId: "U_ALICE" } }, 15),
	];
	const t2ProcessedThrough = t2Events[6]!.id;

	// -- Turn 3: First fix didn't fully work --
	resetIds();
	const t3Events: AgentEvent[] = [
		mkEvent(
			{
				event_type: "INCIDENT_CREATED",
				event_data: {
					status: "open",
					severity: "medium",
					createdBy: "U_ONCALL",
					...incidentBase,
					source: "slack",
					assignee: "U_ONCALL",
					entryPointId: "ep_1",
					rotationId: "rot_1",
				},
			},
			0,
		),
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: { message: "PagerDuty alert: 500 error rate >10% on /api/v2/payments. Customers unable to complete purchases.", userId: "U_ALICE" },
			},
			1,
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Confirmed — payment failures affecting all customers. Revenue impacted.", userId: "U_BOB" } }, 3),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Looking into the payment service logs now.", userId: "U_ALICE" } }, 5),
		mkEvent({ event_type: "SEVERITY_UPDATE", event_data: { severity: "high" } }, 6),
		mkSuggestionEvent({ action: "update_severity", severity: "high" }, 6, "sug_a_1"),
		mkEvent({ event_type: "AFFECTION_UPDATE", event_data: { status: "investigating", title: "Payment processing failures", services: [{ id: "svc_api", impact: "major" }] } }, 7),
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: { message: "Root cause identified — DB connection pool exhausted after latest deploy introduced N+1 queries on payment validation.", userId: "U_ALICE" },
			},
			10,
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Deploying hotfix to revert the problematic query pattern.", userId: "U_ALICE" } }, 12),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Hotfix deployed to all instances.", userId: "U_ALICE" } }, 15),
		// Agent suggested mitigating — dispatcher applied
		mkSuggestionEvent({ action: "update_status", status: "mitigating", message: "Hotfix deployed reverting N+1 query pattern" }, 16, "sug_a_2"),
		mkEvent({ event_type: "STATUS_UPDATE", event_data: { status: "mitigating", message: "Hotfix deployed reverting N+1 query pattern" } }, 17),
		// Agent also suggested status page update — dispatcher did NOT apply it
		mkSuggestionEvent(
			{ action: "add_status_page_update", message: "We are investigating payment processing issues", affectionStatus: "investigating", title: "Payment failures" },
			16,
			"sug_a_3",
		),
		// New events: fix didn't fully work
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Error rate dropped from 15% to 3% but not zero yet.", userId: "U_ALICE" } }, 22),
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: { message: "Some payment retries are still failing. Looks like there's a stale connection pool on some instances.", userId: "U_BOB" },
			},
			25,
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Doing a rolling restart of payment service pods.", userId: "U_ALICE" } }, 27),
	];
	const t3ProcessedThrough = t3Events[12]!.id;

	// -- Turn 4: Second fix confirmed working --
	resetIds();
	const t4Events: AgentEvent[] = [
		...t3Events.map((e, i) => ({ ...e, id: i + 1 })),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Rolling restart complete. All pods healthy with fresh connection pools.", userId: "U_ALICE" } }, 35),
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: { message: "Payment error rate at 0% for the last 15 minutes. All retried payments succeeded. Confirmed working.", userId: "U_BOB" },
			},
			40,
		),
	];
	const t4ProcessedThrough = t4Events[15]!.id;

	return {
		id: "api",
		name: "API Incident: Payment Processing Failures",
		description: "500 errors on payments endpoint due to DB connection pool exhaustion. First fix partial, second fix resolves.",
		turns: [
			{
				name: "Turn 1: Alert fires — investigating, no action taken",
				context: {
					incident: baseIncident(incidentBase),
					services: SERVICES,
					affection: { hasAffection: false },
					events: t1Events,
					processedThroughId: 0,
					validStatusTransitions: ["mitigating", "resolved"],
				},
				checks: [
					shouldNotSuggest("update_status", (s) => s.action === "update_status" && s.status === "mitigating"),
					shouldNotSuggest("update_status", (s) => s.action === "update_status" && s.status === "resolved"),
					shouldSuggest("add_status_page_update", (s) => s.action === "add_status_page_update" && s.affectionStatus === "investigating"),
				],
			},
			{
				name: "Turn 2: Hotfix deployed — should suggest mitigating",
				context: {
					incident: baseIncident({ ...incidentBase, severity: "high" }),
					services: SERVICES,
					affection: { hasAffection: true, lastStatus: "investigating" },
					events: t2Events,
					processedThroughId: t2ProcessedThrough,
					validStatusTransitions: ["mitigating", "resolved"],
				},
				checks: [
					shouldSuggest("update_status", (s) => s.action === "update_status" && s.status === "mitigating"),
					shouldNotSuggest("update_status", (s) => s.action === "update_status" && s.status === "resolved"),
					shouldNotSuggest("update_severity", (s) => s.action === "update_severity" && s.severity === "high"),
				],
			},
			{
				name: "Turn 3: Fix didn't fully work — no resolved, no re-suggest",
				context: {
					incident: baseIncident({ ...incidentBase, status: "mitigating", severity: "high" }),
					services: SERVICES,
					affection: { hasAffection: true, lastStatus: "investigating" },
					events: t3Events,
					processedThroughId: t3ProcessedThrough,
					validStatusTransitions: ["resolved"],
				},
				checks: [
					shouldNotSuggest("update_status", (s) => s.action === "update_status" && s.status === "resolved"),
					shouldNotSuggest("add_status_page_update", (s) => s.action === "add_status_page_update" && s.affectionStatus === "resolved"),
				],
			},
			{
				name: "Turn 4: Confirmed working — should suggest resolved",
				context: {
					incident: baseIncident({ ...incidentBase, status: "mitigating", severity: "high" }),
					services: SERVICES,
					affection: { hasAffection: true, lastStatus: "investigating" },
					events: t4Events,
					processedThroughId: t4ProcessedThrough,
					validStatusTransitions: ["resolved"],
				},
				checks: [shouldSuggest("update_status", (s) => s.action === "update_status" && s.status === "resolved")],
			},
		],
	};
}

// ---------------------------------------------------------------------------
// Scenario 3: Background Jobs — Data Pipeline Stalled
// ---------------------------------------------------------------------------

function buildBackgroundJobsScenario(): LifecycleScenario {
	const SERVICES: AgentSuggestionContext["services"] = [
		{ id: "svc_web", name: "Web Application", prompt: "Customer-facing web application (app.example.com)" },
		{ id: "svc_api", name: "REST API", prompt: "Public REST API for integrations (api.example.com)" },
		{ id: "svc_admin", name: "Admin Dashboard", prompt: "Internal admin dashboard for account management" },
		{ id: "svc_workers", name: "Background Workers", prompt: "Async job processing (emails, reports, data sync)" },
		{ id: "svc_docs", name: "Documentation", prompt: "Public documentation site (docs.example.com)" },
	];

	const incidentBase = {
		title: "Internal analytics pipeline stalled — 3hr backlog",
		description: "Internal daily analytics pipeline stuck, internal team dashboards showing stale data. No customer impact.",
		prompt: "Investigate internal data pipeline stall",
	};

	// -- Turn 1: Pipeline stalled, investigating --
	resetIds();
	const t1Events: AgentEvent[] = [
		mkEvent(
			{
				event_type: "INCIDENT_CREATED",
				event_data: { status: "open", severity: "low", createdBy: "U_ONCALL", ...incidentBase, source: "slack", assignee: "U_ONCALL", entryPointId: "ep_1", rotationId: "rot_1" },
			},
			0,
		),
		mkEvent(
			{ event_type: "MESSAGE_ADDED", event_data: { message: "Daily analytics pipeline has been stuck for 3 hours. Normally completes in 30 minutes.", userId: "U_CAROL" } },
			2,
		),
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: { message: "Internal team dashboards showing stale data from yesterday. This only affects internal reporting — no customer-facing impact.", userId: "U_CAROL" },
			},
			4,
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Checking worker pod logs and resource usage.", userId: "U_CAROL" } }, 6),
	];

	// -- Turn 2: Root cause found, workers restarted --
	resetIds();
	const t2Events: AgentEvent[] = [
		mkEvent(
			{
				event_type: "INCIDENT_CREATED",
				event_data: { status: "open", severity: "low", createdBy: "U_ONCALL", ...incidentBase, source: "slack", assignee: "U_ONCALL", entryPointId: "ep_1", rotationId: "rot_1" },
			},
			0,
		),
		mkEvent(
			{ event_type: "MESSAGE_ADDED", event_data: { message: "Daily analytics pipeline has been stuck for 3 hours. Normally completes in 30 minutes.", userId: "U_CAROL" } },
			2,
		),
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: { message: "Internal team dashboards showing stale data from yesterday. This only affects internal reporting — no customer-facing impact.", userId: "U_CAROL" },
			},
			4,
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Checking worker pod logs and resource usage.", userId: "U_CAROL" } }, 6),
		mkEvent({ event_type: "SEVERITY_UPDATE", event_data: { severity: "medium" } }, 8),
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: { message: "Found the issue — worker pods running out of memory processing a large batch of new records from yesterday's data import.", userId: "U_CAROL" },
			},
			12,
		),
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: { message: "Increased worker memory limits from 2GB to 8GB and restarted the pipeline with smaller batch sizes.", userId: "U_CAROL" },
			},
			15,
		),
	];

	// -- Turn 3: Processing but not caught up --
	resetIds();
	const t3Events: AgentEvent[] = [
		mkEvent(
			{
				event_type: "INCIDENT_CREATED",
				event_data: { status: "open", severity: "low", createdBy: "U_ONCALL", ...incidentBase, source: "slack", assignee: "U_ONCALL", entryPointId: "ep_1", rotationId: "rot_1" },
			},
			0,
		),
		mkEvent(
			{ event_type: "MESSAGE_ADDED", event_data: { message: "Daily analytics pipeline has been stuck for 3 hours. Normally completes in 30 minutes.", userId: "U_CAROL" } },
			2,
		),
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: { message: "Internal team dashboards showing stale data from yesterday. This only affects internal reporting — no customer-facing impact.", userId: "U_CAROL" },
			},
			4,
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Checking worker pod logs and resource usage.", userId: "U_CAROL" } }, 6),
		mkEvent({ event_type: "SEVERITY_UPDATE", event_data: { severity: "medium" } }, 8),
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: { message: "Found the issue — worker pods running out of memory processing a large batch of new records from yesterday's data import.", userId: "U_CAROL" },
			},
			12,
		),
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: { message: "Increased worker memory limits from 2GB to 8GB and restarted the pipeline with smaller batch sizes.", userId: "U_CAROL" },
			},
			15,
		),
		// Agent suggested mitigating — dispatcher applied
		mkSuggestionEvent({ action: "update_status", status: "mitigating", message: "Workers restarted with increased memory and smaller batches" }, 16, "sug_j_1"),
		mkEvent({ event_type: "STATUS_UPDATE", event_data: { status: "mitigating", message: "Workers restarted with increased memory and smaller batches" } }, 17),
		// New events
		mkEvent(
			{ event_type: "MESSAGE_ADDED", event_data: { message: "Pipeline is processing again but still catching up on the backlog. About 60% through.", userId: "U_CAROL" } },
			25,
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Still draining, estimated 45 more minutes to clear the full queue.", userId: "U_CAROL" } }, 30),
	];
	const t3ProcessedThrough = t3Events[8]!.id;

	// -- Turn 4: Pipeline fully caught up --
	resetIds();
	const t4Events: AgentEvent[] = [
		...t3Events.map((e, i) => ({ ...e, id: i + 1 })),
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: { message: "Pipeline has fully caught up. All records processed successfully, dashboards now showing current data.", userId: "U_CAROL" },
			},
			70,
		),
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: { message: "Verified — data integrity checks pass, analytics reports are accurate and up to date. No delivery failures.", userId: "U_DAVE" },
			},
			75,
		),
	];
	const t4ProcessedThrough = t4Events[10]!.id;

	return {
		id: "jobs",
		name: "Background Jobs: Data Pipeline Stalled",
		description: "Internal analytics pipeline stalled due to OOM workers. Restart with more memory, wait for backlog to clear.",
		turns: [
			{
				name: "Turn 1: Pipeline stalled — investigating, no action taken",
				context: {
					incident: baseIncident({ ...incidentBase, severity: "low" }),
					services: SERVICES,
					affection: { hasAffection: false },
					events: t1Events,
					processedThroughId: 0,
					validStatusTransitions: ["mitigating", "resolved"],
				},
				checks: [
					shouldNotSuggest("update_status", (s) => s.action === "update_status" && s.status === "mitigating"),
					shouldNotSuggest("update_status", (s) => s.action === "update_status" && s.status === "resolved"),
					shouldNotSuggest("add_status_page_update"),
				],
			},
			{
				name: "Turn 2: Workers restarted — should suggest mitigating",
				context: {
					incident: baseIncident({ ...incidentBase, severity: "medium" }),
					services: SERVICES,
					affection: { hasAffection: false },
					events: t2Events,
					processedThroughId: 0,
					validStatusTransitions: ["mitigating", "resolved"],
				},
				checks: [
					shouldSuggest("update_status", (s) => s.action === "update_status" && s.status === "mitigating"),
					shouldNotSuggest("update_status", (s) => s.action === "update_status" && s.status === "resolved"),
					shouldNotSuggest("add_status_page_update"),
				],
			},
			{
				name: "Turn 3: Still processing — no resolved, no re-suggest mitigating",
				context: {
					incident: baseIncident({ ...incidentBase, status: "mitigating", severity: "medium" }),
					services: SERVICES,
					affection: { hasAffection: false },
					events: t3Events,
					processedThroughId: t3ProcessedThrough,
					validStatusTransitions: ["resolved"],
				},
				checks: [shouldNotSuggest("update_status", (s) => s.action === "update_status" && s.status === "resolved"), shouldNotSuggest("add_status_page_update")],
			},
			{
				name: "Turn 4: Fully caught up — should suggest resolved",
				context: {
					incident: baseIncident({ ...incidentBase, status: "mitigating", severity: "medium" }),
					services: SERVICES,
					affection: { hasAffection: false },
					events: t4Events,
					processedThroughId: t4ProcessedThrough,
					validStatusTransitions: ["resolved"],
				},
				checks: [shouldSuggest("update_status", (s) => s.action === "update_status" && s.status === "resolved"), shouldNotSuggest("add_status_page_update")],
			},
		],
	};
}

// ---------------------------------------------------------------------------
// Scenario 4: Internal/Demo — Demo Environment Database Corruption
// ---------------------------------------------------------------------------

function buildInternalIncidentScenario(): LifecycleScenario {
	const SERVICES: AgentSuggestionContext["services"] = [
		{ id: "svc_web", name: "Web Application", prompt: "Customer-facing web application (app.example.com)" },
		{ id: "svc_api", name: "REST API", prompt: "Public REST API for integrations (api.example.com)" },
		{ id: "svc_admin", name: "Admin Dashboard", prompt: "Internal admin dashboard for account management" },
		{ id: "svc_workers", name: "Background Workers", prompt: "Async job processing (emails, reports, data sync)" },
		{ id: "svc_docs", name: "Documentation", prompt: "Public documentation site (docs.example.com)" },
	];

	const incidentBase = {
		title: "Demo environment database corruption after migration",
		description: "Demo/staging environment has corrupted data after migration script ran against wrong schema",
		prompt: "Investigate demo environment DB corruption",
	};

	// -- Turn 1: Incident created, demo environment broken --
	resetIds();
	const t1Events: AgentEvent[] = [
		mkEvent(
			{
				event_type: "INCIDENT_CREATED",
				event_data: { status: "open", severity: "low", createdBy: "U_ONCALL", ...incidentBase, source: "slack", assignee: "U_ONCALL", entryPointId: "ep_1", rotationId: "rot_1" },
			},
			0,
		),
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: { message: "Demo environment DB has corrupted data after migration #452 ran against wrong schema", userId: "U_CAROL" },
			},
			2,
		),
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: {
					message: "Internal team members testing on demo.example.com are seeing errors. This is our internal demo/sandbox environment only — no production or customer impact.",
					userId: "U_CAROL",
				},
			},
			4,
		),
	];

	// -- Turn 2: Fix being applied --
	resetIds();
	const t2Events: AgentEvent[] = [
		mkEvent(
			{
				event_type: "INCIDENT_CREATED",
				event_data: { status: "open", severity: "low", createdBy: "U_ONCALL", ...incidentBase, source: "slack", assignee: "U_ONCALL", entryPointId: "ep_1", rotationId: "rot_1" },
			},
			0,
		),
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: { message: "Demo environment DB has corrupted data after migration #452 ran against wrong schema", userId: "U_CAROL" },
			},
			2,
		),
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: {
					message: "Internal team members testing on demo.example.com are seeing errors. This is our internal demo/sandbox environment only — no production or customer impact.",
					userId: "U_CAROL",
				},
			},
			4,
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Restoring demo DB from last night's backup", userId: "U_CAROL" } }, 8),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Backup restore complete, re-running migration with correct schema", userId: "U_CAROL" } }, 12),
	];

	// -- Turn 3: Monitoring --
	resetIds();
	const t3Events: AgentEvent[] = [
		mkEvent(
			{
				event_type: "INCIDENT_CREATED",
				event_data: { status: "open", severity: "low", createdBy: "U_ONCALL", ...incidentBase, source: "slack", assignee: "U_ONCALL", entryPointId: "ep_1", rotationId: "rot_1" },
			},
			0,
		),
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: { message: "Demo environment DB has corrupted data after migration #452 ran against wrong schema", userId: "U_CAROL" },
			},
			2,
		),
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: {
					message: "Internal team members testing on demo.example.com are seeing errors. This is our internal demo/sandbox environment only — no production or customer impact.",
					userId: "U_CAROL",
				},
			},
			4,
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Restoring demo DB from last night's backup", userId: "U_CAROL" } }, 8),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Backup restore complete, re-running migration with correct schema", userId: "U_CAROL" } }, 12),
		// Agent suggested mitigating — dispatcher applied
		mkSuggestionEvent({ action: "update_status", status: "mitigating", message: "Demo DB restored from backup, re-running migration with correct schema" }, 13, "sug_i_1"),
		mkEvent({ event_type: "STATUS_UPDATE", event_data: { status: "mitigating", message: "Demo DB restored from backup, re-running migration with correct schema" } }, 14),
		// New events
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Demo environment is back up, verifying data integrity", userId: "U_CAROL" } }, 18),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Some test accounts still have stale data, re-seeding", userId: "U_CAROL" } }, 22),
	];
	const t3ProcessedThrough = t3Events[6]!.id;

	// -- Turn 4: Confirmed fixed --
	resetIds();
	const t4Events: AgentEvent[] = [
		...t3Events.map((e, i) => ({ ...e, id: i + 1 })),
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: { message: "Demo environment fully restored. All test accounts working correctly. Verified.", userId: "U_CAROL" },
			},
			30,
		),
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: { message: "Confirmed — demo.example.com is operational and data is clean.", userId: "U_DAVE" },
			},
			35,
		),
	];
	const t4ProcessedThrough = t4Events[8]!.id;

	return {
		id: "internal",
		name: "Internal/Demo: Demo Environment Database Corruption",
		description: "Demo environment DB corrupted after bad migration. Restore from backup, re-run migration, verify data.",
		turns: [
			{
				name: "Turn 1: Demo environment broken — no action taken",
				context: {
					incident: baseIncident({ ...incidentBase, severity: "low" }),
					services: SERVICES,
					affection: { hasAffection: false },
					events: t1Events,
					processedThroughId: 0,
					validStatusTransitions: ["mitigating", "resolved"],
				},
				checks: [shouldNotSuggest("add_status_page_update"), shouldNotSuggest("update_status", (s) => s.action === "update_status" && s.status === "mitigating")],
			},
			{
				name: "Turn 2: Fix being applied — should suggest mitigating",
				context: {
					incident: baseIncident({ ...incidentBase, severity: "low" }),
					services: SERVICES,
					affection: { hasAffection: false },
					events: t2Events,
					processedThroughId: 0,
					validStatusTransitions: ["mitigating", "resolved"],
				},
				checks: [shouldSuggest("update_status", (s) => s.action === "update_status" && s.status === "mitigating"), shouldNotSuggest("add_status_page_update")],
			},
			{
				name: "Turn 3: Monitoring — no resolved, no status page",
				context: {
					incident: baseIncident({ ...incidentBase, status: "mitigating", severity: "low" }),
					services: SERVICES,
					affection: { hasAffection: false },
					events: t3Events,
					processedThroughId: t3ProcessedThrough,
					validStatusTransitions: ["resolved"],
				},
				checks: [shouldNotSuggest("update_status", (s) => s.action === "update_status" && s.status === "resolved"), shouldNotSuggest("add_status_page_update")],
			},
			{
				name: "Turn 4: Confirmed fixed — should suggest resolved",
				context: {
					incident: baseIncident({ ...incidentBase, status: "mitigating", severity: "low" }),
					services: SERVICES,
					affection: { hasAffection: false },
					events: t4Events,
					processedThroughId: t4ProcessedThrough,
					validStatusTransitions: ["resolved"],
				},
				checks: [shouldSuggest("update_status", (s) => s.action === "update_status" && s.status === "resolved"), shouldNotSuggest("add_status_page_update")],
			},
		],
	};
}

// ---------------------------------------------------------------------------
// Scenario 5: Vague Report — "Something is broken"
// Starts very vague, gradually gets clearer over turns
// ---------------------------------------------------------------------------

function buildVagueReportScenario(): LifecycleScenario {
	const SERVICES: AgentSuggestionContext["services"] = [
		{ id: "svc_web", name: "Web Application", prompt: "Customer-facing web application (app.example.com)" },
		{ id: "svc_api", name: "REST API", prompt: "Public REST API for integrations (api.example.com)" },
		{ id: "svc_admin", name: "Admin Dashboard", prompt: "Internal admin dashboard for account management" },
		{ id: "svc_workers", name: "Background Workers", prompt: "Async job processing (emails, reports, data sync)" },
		{ id: "svc_docs", name: "Documentation", prompt: "Public documentation site (docs.example.com)" },
	];

	const incidentBase = {
		title: "Something seems off",
		description: "Unclear reports of issues",
		prompt: "Investigate reports of issues",
	};

	// -- Turn 1: Extremely vague — should suggest nothing --
	resetIds();
	const t1Events: AgentEvent[] = [
		mkEvent(
			{
				event_type: "INCIDENT_CREATED",
				event_data: { status: "open", severity: "low", createdBy: "U_ONCALL", ...incidentBase, source: "slack", assignee: "U_ONCALL", entryPointId: "ep_1", rotationId: "rot_1" },
			},
			0,
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Hey, something seems off. A few users pinged me about issues.", userId: "U_ALICE" } }, 2),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Looking into it", userId: "U_BOB" } }, 4),
	];

	// -- Turn 2: Still vague, contradictory signals — should suggest nothing --
	resetIds();
	const t2Events: AgentEvent[] = [
		mkEvent(
			{
				event_type: "INCIDENT_CREATED",
				event_data: { status: "open", severity: "low", createdBy: "U_ONCALL", ...incidentBase, source: "slack", assignee: "U_ONCALL", entryPointId: "ep_1", rotationId: "rot_1" },
			},
			0,
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Hey, something seems off. A few users pinged me about issues.", userId: "U_ALICE" } }, 2),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Looking into it", userId: "U_BOB" } }, 4),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "I checked the dashboard, metrics look normal to me", userId: "U_BOB" } }, 8),
		mkEvent(
			{ event_type: "MESSAGE_ADDED", event_data: { message: "Hmm one user says checkout is slow, another says pages won't load. Could be unrelated.", userId: "U_ALICE" } },
			10,
		),
	];

	// -- Turn 3: Clarity emerges — confirmed API issue, action taken --
	resetIds();
	const t3Events: AgentEvent[] = [
		mkEvent(
			{
				event_type: "INCIDENT_CREATED",
				event_data: { status: "open", severity: "low", createdBy: "U_ONCALL", ...incidentBase, source: "slack", assignee: "U_ONCALL", entryPointId: "ep_1", rotationId: "rot_1" },
			},
			0,
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Hey, something seems off. A few users pinged me about issues.", userId: "U_ALICE" } }, 2),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Looking into it", userId: "U_BOB" } }, 4),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "I checked the dashboard, metrics look normal to me", userId: "U_BOB" } }, 8),
		mkEvent(
			{ event_type: "MESSAGE_ADDED", event_data: { message: "Hmm one user says checkout is slow, another says pages won't load. Could be unrelated.", userId: "U_ALICE" } },
			10,
		),
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: {
					message: "Found it — API latency spiked to 5s at 14:32. Traced to a slow DB query in the checkout flow. This is affecting all API consumers.",
					userId: "U_BOB",
				},
			},
			15,
		),
		mkEvent({ event_type: "SEVERITY_UPDATE", event_data: { severity: "high" } }, 16),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Deployed a query optimization fix. API latency dropping back to normal.", userId: "U_BOB" } }, 20),
	];
	const t3ProcessedThrough = t3Events[4]!.id;

	// -- Turn 4: Confirmed fixed --
	resetIds();
	const t4Events: AgentEvent[] = [
		mkEvent(
			{
				event_type: "INCIDENT_CREATED",
				event_data: { status: "open", severity: "low", createdBy: "U_ONCALL", ...incidentBase, source: "slack", assignee: "U_ONCALL", entryPointId: "ep_1", rotationId: "rot_1" },
			},
			0,
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Hey, something seems off. A few users pinged me about issues.", userId: "U_ALICE" } }, 2),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Looking into it", userId: "U_BOB" } }, 4),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "I checked the dashboard, metrics look normal to me", userId: "U_BOB" } }, 8),
		mkEvent(
			{ event_type: "MESSAGE_ADDED", event_data: { message: "Hmm one user says checkout is slow, another says pages won't load. Could be unrelated.", userId: "U_ALICE" } },
			10,
		),
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: {
					message: "Found it — API latency spiked to 5s at 14:32. Traced to a slow DB query in the checkout flow. This is affecting all API consumers.",
					userId: "U_BOB",
				},
			},
			15,
		),
		mkEvent({ event_type: "SEVERITY_UPDATE", event_data: { severity: "high" } }, 16),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Deployed a query optimization fix. API latency dropping back to normal.", userId: "U_BOB" } }, 20),
		mkSuggestionEvent({ action: "update_status", status: "mitigating", message: "Query optimization fix deployed for slow checkout DB query" }, 21, "sug_v_1"),
		mkEvent({ event_type: "STATUS_UPDATE", event_data: { status: "mitigating", message: "Query optimization fix deployed for slow checkout DB query" } }, 22),
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: { message: "API latency back to normal across all regions. P99 is 120ms, well within SLA. Confirmed by multiple users.", userId: "U_BOB" },
			},
			30,
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "All clear — no more user reports. Closing this out.", userId: "U_ALICE" } }, 35),
	];
	const t4ProcessedThrough = t4Events[9]!.id;

	return {
		id: "vague",
		name: "Vague Report: Gradual Clarity",
		description: "Starts with 'something seems off', details emerge over turns. Should not suggest anything until picture is clear.",
		turns: [
			{
				name: "Turn 1: Extremely vague report — no suggestions",
				context: {
					incident: baseIncident({ ...incidentBase, severity: "low" }),
					services: SERVICES,
					affection: { hasAffection: false },
					events: t1Events,
					processedThroughId: 0,
					validStatusTransitions: ["mitigating", "resolved"],
				},
				checks: [shouldNotSuggest("update_status"), shouldNotSuggest("update_severity"), shouldNotSuggest("add_status_page_update")],
			},
			{
				name: "Turn 2: Contradictory signals — still no suggestions",
				context: {
					incident: baseIncident({ ...incidentBase, severity: "low" }),
					services: SERVICES,
					affection: { hasAffection: false },
					events: t2Events,
					processedThroughId: 0,
					validStatusTransitions: ["mitigating", "resolved"],
				},
				checks: [shouldNotSuggest("update_status"), shouldNotSuggest("update_severity"), shouldNotSuggest("add_status_page_update")],
			},
			{
				name: "Turn 3: Clarity + fix deployed — should suggest mitigating + status page",
				context: {
					incident: baseIncident({ ...incidentBase, severity: "high" }),
					services: SERVICES,
					affection: { hasAffection: false },
					events: t3Events,
					processedThroughId: t3ProcessedThrough,
					validStatusTransitions: ["mitigating", "resolved"],
				},
				checks: [
					shouldSuggest("update_status", (s) => s.action === "update_status" && s.status === "mitigating"),
					shouldNotSuggest("update_status", (s) => s.action === "update_status" && s.status === "resolved"),
					shouldSuggest("add_status_page_update", (s) => s.action === "add_status_page_update" && (s.affectionStatus === "investigating" || s.affectionStatus === "mitigating")),
				],
			},
			{
				name: "Turn 4: Confirmed fixed — should suggest resolved",
				context: {
					incident: baseIncident({ ...incidentBase, status: "mitigating", severity: "high" }),
					services: SERVICES,
					affection: { hasAffection: true, lastStatus: "investigating" },
					events: t4Events,
					processedThroughId: t4ProcessedThrough,
					validStatusTransitions: ["resolved"],
				},
				checks: [shouldSuggest("update_status", (s) => s.action === "update_status" && s.status === "resolved")],
			},
		],
	};
}

// ---------------------------------------------------------------------------
// Scenario 6: Noisy Alerts — Multiple Unrelated Signals
// Alerts fire but nothing is actually confirmed broken
// ---------------------------------------------------------------------------

function buildNoisyAlertsScenario(): LifecycleScenario {
	const SERVICES: AgentSuggestionContext["services"] = [
		{ id: "svc_web", name: "Web Application", prompt: "Customer-facing web application (app.example.com)" },
		{ id: "svc_api", name: "REST API", prompt: "Public REST API for integrations (api.example.com)" },
		{ id: "svc_admin", name: "Admin Dashboard", prompt: "Internal admin dashboard for account management" },
		{ id: "svc_workers", name: "Background Workers", prompt: "Async job processing (emails, reports, data sync)" },
		{ id: "svc_docs", name: "Documentation", prompt: "Public documentation site (docs.example.com)" },
	];

	const incidentBase = {
		title: "Multiple alerts firing",
		description: "Several monitoring alerts triggered across different services",
		prompt: "Investigate multiple alerts",
	};

	// -- Turn 1: Noisy alerts, nothing confirmed — should suggest nothing --
	resetIds();
	const t1Events: AgentEvent[] = [
		mkEvent(
			{
				event_type: "INCIDENT_CREATED",
				event_data: {
					status: "open",
					severity: "medium",
					createdBy: "U_ONCALL",
					...incidentBase,
					source: "slack",
					assignee: "U_ONCALL",
					entryPointId: "ep_1",
					rotationId: "rot_1",
				},
			},
			0,
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "PagerDuty alert: CPU spike on worker-pool-3. Auto-resolved after 2 minutes.", userId: "U_ALICE" } }, 2),
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: { message: "Got a Datadog alert for elevated 5xx on /api/health — might be a blip from the deploy 10 min ago.", userId: "U_BOB" },
			},
			4,
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "One user reported slow page loads but couldn't reproduce. Might be their network.", userId: "U_ALICE" } }, 6),
	];

	// -- Turn 2: False alarm confirmed, team discussing closing --
	resetIds();
	const t2Events: AgentEvent[] = [
		mkEvent(
			{
				event_type: "INCIDENT_CREATED",
				event_data: {
					status: "open",
					severity: "medium",
					createdBy: "U_ONCALL",
					...incidentBase,
					source: "slack",
					assignee: "U_ONCALL",
					entryPointId: "ep_1",
					rotationId: "rot_1",
				},
			},
			0,
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "PagerDuty alert: CPU spike on worker-pool-3. Auto-resolved after 2 minutes.", userId: "U_ALICE" } }, 2),
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: { message: "Got a Datadog alert for elevated 5xx on /api/health — might be a blip from the deploy 10 min ago.", userId: "U_BOB" },
			},
			4,
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "One user reported slow page loads but couldn't reproduce. Might be their network.", userId: "U_ALICE" } }, 6),
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: { message: "CPU alert was a one-off spike during a cron job. 5xx rate is back to baseline. User issue was not reproducible.", userId: "U_BOB" },
			},
			12,
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Looks like a false alarm across the board. Everything is stable now.", userId: "U_ALICE" } }, 15),
	];

	// -- Turn 3: Explicitly confirmed false alarm --
	resetIds();
	const t3Events: AgentEvent[] = [
		mkEvent(
			{
				event_type: "INCIDENT_CREATED",
				event_data: {
					status: "open",
					severity: "medium",
					createdBy: "U_ONCALL",
					...incidentBase,
					source: "slack",
					assignee: "U_ONCALL",
					entryPointId: "ep_1",
					rotationId: "rot_1",
				},
			},
			0,
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "PagerDuty alert: CPU spike on worker-pool-3. Auto-resolved after 2 minutes.", userId: "U_ALICE" } }, 2),
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: { message: "Got a Datadog alert for elevated 5xx on /api/health — might be a blip from the deploy 10 min ago.", userId: "U_BOB" },
			},
			4,
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "One user reported slow page loads but couldn't reproduce. Might be their network.", userId: "U_ALICE" } }, 6),
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: { message: "CPU alert was a one-off spike during a cron job. 5xx rate is back to baseline. User issue was not reproducible.", userId: "U_BOB" },
			},
			12,
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Looks like a false alarm across the board. Everything is stable now.", userId: "U_ALICE" } }, 15),
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: { message: "Confirmed — all metrics nominal for the last 30 minutes. Nothing to fix here, closing this incident.", userId: "U_BOB" },
			},
			20,
		),
	];

	return {
		id: "noisy",
		name: "Noisy Alerts: False Alarm",
		description: "Multiple alerts fire but nothing is actually broken. Should not suggest actions until confirmed false alarm, then suggest resolved.",
		turns: [
			{
				name: "Turn 1: Noisy alerts, nothing confirmed — no suggestions",
				context: {
					incident: baseIncident({ ...incidentBase, severity: "medium" }),
					services: SERVICES,
					affection: { hasAffection: false },
					events: t1Events,
					processedThroughId: 0,
					validStatusTransitions: ["mitigating", "resolved"],
				},
				checks: [shouldNotSuggest("update_status"), shouldNotSuggest("add_status_page_update")],
			},
			{
				name: "Turn 2: False alarm likely — should suggest resolved",
				context: {
					incident: baseIncident({ ...incidentBase, severity: "medium" }),
					services: SERVICES,
					affection: { hasAffection: false },
					events: t2Events,
					processedThroughId: 0,
					validStatusTransitions: ["mitigating", "resolved"],
				},
				checks: [shouldSuggest("update_status", (s) => s.action === "update_status" && s.status === "resolved"), shouldNotSuggest("add_status_page_update")],
			},
			{
				name: "Turn 3: Explicitly confirmed false alarm — should suggest resolved",
				context: {
					incident: baseIncident({ ...incidentBase, severity: "medium" }),
					services: SERVICES,
					affection: { hasAffection: false },
					events: t3Events,
					processedThroughId: 0,
					validStatusTransitions: ["mitigating", "resolved"],
				},
				checks: [shouldSuggest("update_status", (s) => s.action === "update_status" && s.status === "resolved"), shouldNotSuggest("add_status_page_update")],
			},
		],
	};
}

// ---------------------------------------------------------------------------
// Scenario 7: Severity Escalation and De-escalation
// Starts low, escalates to high, then narrows scope and de-escalates
// ---------------------------------------------------------------------------

function buildSeverityScenario(): LifecycleScenario {
	const SERVICES: AgentSuggestionContext["services"] = [
		{ id: "svc_web", name: "Web Application", prompt: "Customer-facing web application (app.example.com)" },
		{ id: "svc_api", name: "REST API", prompt: "Public REST API for integrations (api.example.com)" },
		{ id: "svc_admin", name: "Admin Dashboard", prompt: "Internal admin dashboard for account management" },
		{ id: "svc_workers", name: "Background Workers", prompt: "Async job processing (emails, reports, data sync)" },
		{ id: "svc_docs", name: "Documentation", prompt: "Public documentation site (docs.example.com)" },
	];

	const incidentBase = {
		title: "Elevated error rates on web app",
		description: "Monitoring showing increased error rates on web application",
		prompt: "Investigate elevated errors",
	};

	// -- Turn 1: Minor blip, low severity — should suggest medium or high --
	resetIds();
	const t1Events: AgentEvent[] = [
		mkEvent(
			{
				event_type: "INCIDENT_CREATED",
				event_data: { status: "open", severity: "low", createdBy: "U_ONCALL", ...incidentBase, source: "slack", assignee: "U_ONCALL", entryPointId: "ep_1", rotationId: "rot_1" },
			},
			0,
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Error rate spiked to 15% on the web app. Multiple regions affected.", userId: "U_ALICE" } }, 2),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Support queue filling up — 20+ tickets in the last 10 minutes about checkout failures.", userId: "U_BOB" } }, 4),
		mkEvent(
			{ event_type: "MESSAGE_ADDED", event_data: { message: "Confirmed: all users hitting checkout are getting 500 errors. Revenue impact confirmed.", userId: "U_ALICE" } },
			6,
		),
	];

	// -- Turn 2: Now high severity, action taken — should suggest mitigating, NOT re-suggest severity --
	resetIds();
	const t2Events: AgentEvent[] = [
		mkEvent(
			{
				event_type: "INCIDENT_CREATED",
				event_data: { status: "open", severity: "low", createdBy: "U_ONCALL", ...incidentBase, source: "slack", assignee: "U_ONCALL", entryPointId: "ep_1", rotationId: "rot_1" },
			},
			0,
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Error rate spiked to 15% on the web app. Multiple regions affected.", userId: "U_ALICE" } }, 2),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Support queue filling up — 20+ tickets in the last 10 minutes about checkout failures.", userId: "U_BOB" } }, 4),
		mkEvent(
			{ event_type: "MESSAGE_ADDED", event_data: { message: "Confirmed: all users hitting checkout are getting 500 errors. Revenue impact confirmed.", userId: "U_ALICE" } },
			6,
		),
		mkSuggestionEvent({ action: "update_severity", severity: "high" }, 7, "sug_s_1"),
		mkEvent({ event_type: "SEVERITY_UPDATE", event_data: { severity: "high" } }, 8),
		mkEvent(
			{ event_type: "MESSAGE_ADDED", event_data: { message: "Root cause: bad database migration broke the orders table index. Rolling back the migration now.", userId: "U_BOB" } },
			12,
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Migration rollback complete. Error rate dropping — down to 5% and falling.", userId: "U_BOB" } }, 16),
	];
	const t2ProcessedThrough = t2Events[3]!.id;

	// -- Turn 3: Scope narrowed — only one endpoint affected, should suggest medium --
	resetIds();
	const t3Events: AgentEvent[] = [
		mkEvent(
			{
				event_type: "INCIDENT_CREATED",
				event_data: { status: "open", severity: "low", createdBy: "U_ONCALL", ...incidentBase, source: "slack", assignee: "U_ONCALL", entryPointId: "ep_1", rotationId: "rot_1" },
			},
			0,
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Error rate spiked to 15% on the web app. Multiple regions affected.", userId: "U_ALICE" } }, 2),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Support queue filling up — 20+ tickets in the last 10 minutes about checkout failures.", userId: "U_BOB" } }, 4),
		mkEvent(
			{ event_type: "MESSAGE_ADDED", event_data: { message: "Confirmed: all users hitting checkout are getting 500 errors. Revenue impact confirmed.", userId: "U_ALICE" } },
			6,
		),
		mkSuggestionEvent({ action: "update_severity", severity: "high" }, 7, "sug_s_1"),
		mkEvent({ event_type: "SEVERITY_UPDATE", event_data: { severity: "high" } }, 8),
		mkEvent(
			{ event_type: "MESSAGE_ADDED", event_data: { message: "Root cause: bad database migration broke the orders table index. Rolling back the migration now.", userId: "U_BOB" } },
			12,
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Migration rollback complete. Error rate dropping — down to 5% and falling.", userId: "U_BOB" } }, 16),
		mkSuggestionEvent({ action: "update_status", status: "mitigating", message: "Database migration rolled back" }, 17, "sug_s_2"),
		mkEvent({ event_type: "STATUS_UPDATE", event_data: { status: "mitigating", message: "Database migration rolled back" } }, 18),
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: {
					message: "Most errors resolved. Only the /orders/export endpoint still has issues — it's a rarely used admin feature, not customer-facing checkout.",
					userId: "U_BOB",
				},
			},
			22,
		),
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: {
					message: "Main checkout flow fully operational. The remaining /orders/export issue only affects internal reporting. Downgrading severity.",
					userId: "U_ALICE",
				},
			},
			25,
		),
	];
	const t3ProcessedThrough = t3Events[9]!.id;

	// -- Turn 4: Fully resolved --
	resetIds();
	const t4Events: AgentEvent[] = [
		...t3Events,
		mkSuggestionEvent({ action: "update_severity", severity: "medium" }, 26, "sug_s_3"),
		mkEvent({ event_type: "SEVERITY_UPDATE", event_data: { severity: "medium" } }, 27),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Fixed the /orders/export endpoint too. All endpoints operational, error rate 0%.", userId: "U_BOB" } }, 32),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Confirmed all clear. Checkout, export, everything working. Closing this.", userId: "U_ALICE" } }, 35),
	];
	const t4ProcessedThrough = t4Events[t3Events.length + 1]!.id;

	return {
		id: "severity",
		name: "Severity: Escalation and De-escalation",
		description: "Starts low, escalates to high on confirmed impact, then de-escalates to medium as scope narrows, then resolved.",
		turns: [
			{
				name: "Turn 1: Confirmed revenue impact — should suggest high severity",
				context: {
					incident: baseIncident({ ...incidentBase, severity: "low" }),
					services: SERVICES,
					affection: { hasAffection: false },
					events: t1Events,
					processedThroughId: 0,
					validStatusTransitions: ["mitigating", "resolved"],
				},
				checks: [shouldSuggest("update_severity", (s) => s.action === "update_severity" && s.severity === "high"), shouldNotSuggest("update_status")],
			},
			{
				name: "Turn 2: Fix deployed — should suggest mitigating, not re-suggest severity",
				context: {
					incident: baseIncident({ ...incidentBase, severity: "high" }),
					services: SERVICES,
					affection: { hasAffection: false },
					events: t2Events,
					processedThroughId: t2ProcessedThrough,
					validStatusTransitions: ["mitigating", "resolved"],
				},
				checks: [
					shouldSuggest("update_status", (s) => s.action === "update_status" && s.status === "mitigating"),
					shouldNotSuggest("update_severity", (s) => s.action === "update_severity" && s.severity === "high"),
				],
			},
			{
				name: "Turn 3: Scope narrowed — should de-escalate severity",
				context: {
					incident: baseIncident({ ...incidentBase, status: "mitigating", severity: "high" }),
					services: SERVICES,
					affection: { hasAffection: false },
					events: t3Events,
					processedThroughId: t3ProcessedThrough,
					validStatusTransitions: ["resolved"],
				},
				checks: [
					shouldSuggest("update_severity", (s) => s.action === "update_severity" && (s.severity === "medium" || s.severity === "low")),
					shouldNotSuggest("update_status", (s) => s.action === "update_status" && s.status === "resolved"),
				],
			},
			{
				name: "Turn 4: All fixed — should suggest resolved",
				context: {
					incident: baseIncident({ ...incidentBase, status: "mitigating", severity: "medium" }),
					services: SERVICES,
					affection: { hasAffection: false },
					events: t4Events,
					processedThroughId: t4ProcessedThrough,
					validStatusTransitions: ["resolved"],
				},
				checks: [shouldSuggest("update_status", (s) => s.action === "update_status" && s.status === "resolved")],
			},
		],
	};
}

// ---------------------------------------------------------------------------
// Scenario 8: Status Page Mid-Incident Updates
// Tests that status page updates are suggested during meaningful progress
// ---------------------------------------------------------------------------

function buildStatusPageUpdatesScenario(): LifecycleScenario {
	const SERVICES: AgentSuggestionContext["services"] = [
		{ id: "svc_web", name: "Web Application", prompt: "Customer-facing web application (app.example.com)" },
		{ id: "svc_api", name: "REST API", prompt: "Public REST API for integrations (api.example.com)" },
		{ id: "svc_admin", name: "Admin Dashboard", prompt: "Internal admin dashboard for account management" },
		{ id: "svc_workers", name: "Background Workers", prompt: "Async job processing (emails, reports, data sync)" },
		{ id: "svc_docs", name: "Documentation", prompt: "Public documentation site (docs.example.com)" },
	];

	const incidentBase = {
		title: "API outage — database failover",
		description: "Complete API outage due to primary database failure",
		prompt: "Investigate API outage",
	};

	// -- Turn 1: Major outage — should suggest investigating status page --
	resetIds();
	const t1Events: AgentEvent[] = [
		mkEvent(
			{
				event_type: "INCIDENT_CREATED",
				event_data: { status: "open", severity: "high", createdBy: "U_ONCALL", ...incidentBase, source: "slack", assignee: "U_ONCALL", entryPointId: "ep_1", rotationId: "rot_1" },
			},
			0,
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Primary database is down. All API requests returning 503. Complete outage.", userId: "U_ALICE" } }, 2),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Confirmed total outage — web app, API, everything that hits the DB is down.", userId: "U_BOB" } }, 4),
	];

	// -- Turn 2: Failover initiated, partial recovery — should suggest mitigating + status page update --
	resetIds();
	const t2Events: AgentEvent[] = [
		mkEvent(
			{
				event_type: "INCIDENT_CREATED",
				event_data: { status: "open", severity: "high", createdBy: "U_ONCALL", ...incidentBase, source: "slack", assignee: "U_ONCALL", entryPointId: "ep_1", rotationId: "rot_1" },
			},
			0,
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Primary database is down. All API requests returning 503. Complete outage.", userId: "U_ALICE" } }, 2),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Confirmed total outage — web app, API, everything that hits the DB is down.", userId: "U_BOB" } }, 4),
		mkSuggestionEvent(
			{
				action: "add_status_page_update",
				message: "We are investigating a complete API outage",
				affectionStatus: "investigating",
				title: "API outage",
				services: [
					{ id: "svc_api", impact: "major" },
					{ id: "svc_web", impact: "major" },
				],
			},
			5,
			"sug_sp_1",
		),
		mkEvent({ event_type: "AFFECTION_UPDATE", event_data: { status: "investigating" } }, 6),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Initiated failover to read replica. Read-only operations are coming back online.", userId: "U_BOB" } }, 10),
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: { message: "Read endpoints working. Write operations (orders, account updates) still down. Working on promoting the replica.", userId: "U_BOB" },
			},
			14,
		),
	];
	const t2ProcessedThrough = t2Events[2]!.id;

	// -- Turn 3: More progress, no status change — should suggest status page update --
	resetIds();
	const t3Events: AgentEvent[] = [
		mkEvent(
			{
				event_type: "INCIDENT_CREATED",
				event_data: { status: "open", severity: "high", createdBy: "U_ONCALL", ...incidentBase, source: "slack", assignee: "U_ONCALL", entryPointId: "ep_1", rotationId: "rot_1" },
			},
			0,
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Primary database is down. All API requests returning 503. Complete outage.", userId: "U_ALICE" } }, 2),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Confirmed total outage — web app, API, everything that hits the DB is down.", userId: "U_BOB" } }, 4),
		mkSuggestionEvent(
			{
				action: "add_status_page_update",
				message: "We are investigating a complete API outage",
				affectionStatus: "investigating",
				title: "API outage",
				services: [
					{ id: "svc_api", impact: "major" },
					{ id: "svc_web", impact: "major" },
				],
			},
			5,
			"sug_sp_1",
		),
		mkEvent({ event_type: "AFFECTION_UPDATE", event_data: { status: "investigating" } }, 6),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Initiated failover to read replica. Read-only operations are coming back online.", userId: "U_BOB" } }, 10),
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: { message: "Read endpoints working. Write operations (orders, account updates) still down. Working on promoting the replica.", userId: "U_BOB" },
			},
			14,
		),
		mkSuggestionEvent({ action: "update_status", status: "mitigating", message: "DB failover to read replica initiated; reads recovering" }, 15, "sug_sp_2"),
		mkEvent({ event_type: "STATUS_UPDATE", event_data: { status: "mitigating", message: "DB failover to read replica initiated; reads recovering" } }, 16),
		mkSuggestionEvent({ action: "add_status_page_update", message: "Read operations recovering. Write operations still degraded.", affectionStatus: "mitigating" }, 17, "sug_sp_3"),
		mkEvent({ event_type: "AFFECTION_UPDATE", event_data: { status: "mitigating" } }, 18),
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: { message: "Replica promotion complete. Write operations coming back. Some requests still failing during connection pool refresh.", userId: "U_BOB" },
			},
			25,
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Write success rate is now 85% and climbing. A few stale connections still dropping.", userId: "U_ALICE" } }, 28),
	];
	const t3ProcessedThrough = t3Events[10]!.id;

	// -- Turn 4: Fully recovered --
	resetIds();
	const t4Events: AgentEvent[] = [
		...t3Events,
		mkSuggestionEvent(
			{ action: "add_status_page_update", message: "Replica promoted. Write operations recovering (85% success rate).", affectionStatus: "mitigating" },
			29,
			"sug_sp_4",
		),
		mkEvent({ event_type: "AFFECTION_UPDATE", event_data: { status: "mitigating" } }, 30),
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: { message: "All operations fully recovered. Read and write success rate at 100% for the last 10 minutes. Verified by multiple team members.", userId: "U_BOB" },
			},
			38,
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Confirmed all clear. Everything operational.", userId: "U_ALICE" } }, 40),
	];
	const t4ProcessedThrough = t4Events[t3Events.length + 1]!.id;

	return {
		id: "statuspage",
		name: "Status Page: Mid-Incident Updates",
		description: "Major outage with multiple status page updates during recovery. Tests that updates are suggested on meaningful progress.",
		turns: [
			{
				name: "Turn 1: Complete outage — should suggest investigating status page",
				context: {
					incident: baseIncident({ ...incidentBase, severity: "high" }),
					services: SERVICES,
					affection: { hasAffection: false },
					events: t1Events,
					processedThroughId: 0,
					validStatusTransitions: ["mitigating", "resolved"],
				},
				checks: [shouldSuggest("add_status_page_update", (s) => s.action === "add_status_page_update" && s.affectionStatus === "investigating"), shouldNotSuggest("update_status")],
			},
			{
				name: "Turn 2: Partial recovery — should suggest mitigating + status page update",
				context: {
					incident: baseIncident({ ...incidentBase, severity: "high" }),
					services: SERVICES,
					affection: { hasAffection: true, lastStatus: "investigating" },
					events: t2Events,
					processedThroughId: t2ProcessedThrough,
					validStatusTransitions: ["mitigating", "resolved"],
				},
				checks: [
					shouldSuggest("update_status", (s) => s.action === "update_status" && s.status === "mitigating"),
					shouldNotSuggest("update_status", (s) => s.action === "update_status" && s.status === "resolved"),
					shouldSuggest("add_status_page_update", (s) => s.action === "add_status_page_update" && s.affectionStatus === "mitigating"),
				],
			},
			{
				name: "Turn 3: More progress — should suggest status page update (no status change)",
				context: {
					incident: baseIncident({ ...incidentBase, status: "mitigating", severity: "high" }),
					services: SERVICES,
					affection: { hasAffection: true, lastStatus: "mitigating" },
					events: t3Events,
					processedThroughId: t3ProcessedThrough,
					validStatusTransitions: ["resolved"],
				},
				checks: [shouldSuggest("add_status_page_update"), shouldNotSuggest("update_status", (s) => s.action === "update_status" && s.status === "resolved")],
			},
			{
				name: "Turn 4: Fully recovered — should suggest resolved + status page resolved",
				context: {
					incident: baseIncident({ ...incidentBase, status: "mitigating", severity: "high" }),
					services: SERVICES,
					affection: { hasAffection: true, lastStatus: "mitigating" },
					events: t4Events,
					processedThroughId: t4ProcessedThrough,
					validStatusTransitions: ["resolved"],
				},
				checks: [
					shouldSuggest("update_status", (s) => s.action === "update_status" && s.status === "resolved"),
					shouldSuggest("add_status_page_update", (s) => s.action === "add_status_page_update" && s.affectionStatus === "resolved"),
				],
			},
		],
	};
}

// ---------------------------------------------------------------------------
// Scenario 9: Repeat suppression
// Once suggested, an action should not be suggested again
// ---------------------------------------------------------------------------

function buildRepeatWithDeltaScenario(): LifecycleScenario {
	const SERVICES: AgentSuggestionContext["services"] = [
		{ id: "svc_api", name: "REST API", prompt: "Public REST API for integrations (api.example.com)" },
		{ id: "svc_web", name: "Web Application", prompt: "Customer-facing web application (app.example.com)" },
	];

	const incidentBase = {
		title: "API timeout spike after deploy",
		description: "API latency/timeouts elevated after a deployment",
		prompt: "Investigate API timeout spike",
	};

	resetIds();
	const t1Events: AgentEvent[] = [
		mkEvent(
			{
				event_type: "INCIDENT_CREATED",
				event_data: {
					status: "open",
					severity: "medium",
					createdBy: "U_ONCALL",
					...incidentBase,
					source: "slack",
					assignee: "U_ONCALL",
					entryPointId: "ep_1",
					rotationId: "rot_1",
				},
			},
			0,
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "API p95 up 8x, timeouts impacting requests in two regions.", userId: "U_ALICE" } }, 2),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Rolled back recent API config change; monitoring recovery.", userId: "U_BOB" } }, 5),
	];

	resetIds();
	const t2Events: AgentEvent[] = [
		...t1Events,
		mkSuggestionEvent(
			{ action: "update_status", status: "mitigating", message: "Rollback applied to mitigate API timeouts", evidence: [{ eventId: t1Events[2]!.id }] },
			6,
			"sug_delta_1",
		),
	];
	const t2ProcessedThrough = t1Events[t1Events.length - 1]!.id;

	resetIds();
	const t3Events: AgentEvent[] = [
		...t2Events,
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Applied second mitigation: restarted API pods to flush stale connections.", userId: "U_BOB" } }, 10),
	];
	const t3ProcessedThrough = t2Events[t2Events.length - 1]!.id;

	resetIds();
	const t4Events: AgentEvent[] = [
		...t3Events,
		mkSuggestionEvent(
			{
				action: "update_status",
				status: "mitigating",
				message: "Second mitigation (pod restart) applied; continue monitoring",
				evidence: [{ eventId: t3Events[t3Events.length - 1]!.id }],
			},
			11,
			"sug_delta_2",
		),
	];
	const t4ProcessedThrough = t3Events[t3Events.length - 1]!.id;

	return {
		id: "repeat-delta",
		name: "Repeat Suppression: Never Re-Suggest",
		description: "Prevents repeating the same suggestion even when additional evidence appears.",
		turns: [
			{
				name: "Turn 1: First mitigation action — suggest mitigating",
				context: {
					incident: baseIncident({ ...incidentBase, severity: "medium" }),
					services: SERVICES,
					affection: { hasAffection: false },
					events: t1Events,
					processedThroughId: 0,
					validStatusTransitions: ["mitigating", "resolved"],
				},
				checks: [shouldSuggest("update_status", (s) => s.action === "update_status" && s.status === "mitigating")],
			},
			{
				name: "Turn 2: No new evidence since prior suggestion — should not repeat mitigating",
				context: {
					incident: baseIncident({ ...incidentBase, severity: "medium" }),
					services: SERVICES,
					affection: { hasAffection: false },
					events: t2Events,
					processedThroughId: t2ProcessedThrough,
					validStatusTransitions: ["mitigating", "resolved"],
				},
				checks: [shouldNotSuggest("update_status", (s) => s.action === "update_status" && s.status === "mitigating")],
			},
			{
				name: "Turn 3: New mitigation evidence appears — still should not repeat mitigating",
				context: {
					incident: baseIncident({ ...incidentBase, severity: "medium" }),
					services: SERVICES,
					affection: { hasAffection: false },
					events: t3Events,
					processedThroughId: t3ProcessedThrough,
					validStatusTransitions: ["mitigating", "resolved"],
				},
				checks: [
					shouldNotSuggest("update_status", (s) => s.action === "update_status" && s.status === "mitigating"),
					shouldNotSuggest("update_status", (s) => s.action === "update_status" && s.status === "resolved"),
				],
			},
			{
				name: "Turn 4: Again no new evidence — should not repeat mitigating",
				context: {
					incident: baseIncident({ ...incidentBase, severity: "medium" }),
					services: SERVICES,
					affection: { hasAffection: false },
					events: t4Events,
					processedThroughId: t4ProcessedThrough,
					validStatusTransitions: ["mitigating", "resolved"],
				},
				checks: [shouldNotSuggest("update_status", (s) => s.action === "update_status" && s.status === "mitigating")],
			},
		],
	};
}

// ---------------------------------------------------------------------------
// Scenario 10: First status page update must be investigating
// ---------------------------------------------------------------------------

function buildFirstStatusPageInvestigatingScenario(): LifecycleScenario {
	const SERVICES: AgentSuggestionContext["services"] = [
		{ id: "svc_api", name: "REST API", prompt: "Public REST API for integrations (api.example.com)" },
		{ id: "svc_web", name: "Web Application", prompt: "Customer-facing web application (app.example.com)" },
	];

	const incidentBase = {
		title: "Primary DB failover event",
		description: "Major DB incident causing external customer impact",
		prompt: "Coordinate DB failover incident response",
	};

	resetIds();
	const t1Events: AgentEvent[] = [
		mkEvent(
			{
				event_type: "INCIDENT_CREATED",
				event_data: { status: "open", severity: "high", createdBy: "U_ONCALL", ...incidentBase, source: "slack", assignee: "U_ONCALL", entryPointId: "ep_1", rotationId: "rot_1" },
			},
			0,
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Primary DB is down. API and web are returning 503.", userId: "U_ALICE" } }, 2),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Started failover procedure to replica.", userId: "U_BOB" } }, 4),
	];

	resetIds();
	const t2Events: AgentEvent[] = [
		...t1Events,
		mkSuggestionEvent(
			{
				action: "add_status_page_update",
				message: "Investigating DB outage affecting API and web.",
				affectionStatus: "investigating",
				title: "DB outage affecting API and web",
				services: [
					{ id: "svc_api", impact: "major" },
					{ id: "svc_web", impact: "major" },
				],
				evidence: [{ eventId: t1Events[1]!.id }, { eventId: t1Events[2]!.id }],
			},
			5,
			"sug_firstsp_1",
		),
		mkEvent(
			{
				event_type: "AFFECTION_UPDATE",
				event_data: {
					status: "investigating",
					title: "DB outage affecting API and web",
					services: [
						{ id: "svc_api", impact: "major" },
						{ id: "svc_web", impact: "major" },
					],
				},
			},
			6,
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Read traffic recovered, writes still degraded.", userId: "U_BOB" } }, 9),
	];
	const t2ProcessedThrough = t2Events[t2Events.length - 2]!.id;

	resetIds();
	const t3Events: AgentEvent[] = [
		...t2Events,
		mkSuggestionEvent(
			{
				action: "add_status_page_update",
				message: "Mitigation in progress; partial recovery observed.",
				affectionStatus: "mitigating",
				evidence: [{ eventId: t2Events[t2Events.length - 1]!.id }],
			},
			10,
			"sug_firstsp_2",
		),
		mkEvent({ event_type: "AFFECTION_UPDATE", event_data: { status: "mitigating", message: "Partial recovery in progress" } }, 11),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "All reads/writes healthy for 10m; verified by on-call.", userId: "U_ALICE" } }, 14),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Confirmed all clear, close incident.", userId: "U_BOB" } }, 16),
	];
	const t3ProcessedThrough = t3Events[t3Events.length - 3]!.id;

	return {
		id: "first-statuspage",
		name: "Status Page: First Update Must Be Investigating",
		description: "Ensures first public status-page suggestion is investigating when no affection exists, then transitions to mitigating/resolved alongside lifecycle changes.",
		turns: [
			{
				name: "Turn 1: First external update — must be investigating",
				context: {
					incident: baseIncident({ ...incidentBase, severity: "high" }),
					services: SERVICES,
					affection: { hasAffection: false },
					events: t1Events,
					processedThroughId: 0,
					validStatusTransitions: ["mitigating", "resolved"],
				},
				checks: [
					shouldSuggest("add_status_page_update", (s) => s.action === "add_status_page_update" && s.affectionStatus === "investigating"),
					shouldNotSuggest("add_status_page_update", (s) => s.action === "add_status_page_update" && s.affectionStatus === "mitigating"),
					shouldNotSuggest("add_status_page_update", (s) => s.action === "add_status_page_update" && s.affectionStatus === "resolved"),
				],
			},
			{
				name: "Turn 2: Existing status page + progress — suggest mitigating update",
				context: {
					incident: baseIncident({ ...incidentBase, severity: "high" }),
					services: SERVICES,
					affection: { hasAffection: true, lastStatus: "investigating" },
					events: t2Events,
					processedThroughId: t2ProcessedThrough,
					validStatusTransitions: ["mitigating", "resolved"],
				},
				checks: [
					shouldSuggest("update_status", (s) => s.action === "update_status" && s.status === "mitigating"),
					shouldSuggest("add_status_page_update", (s) => s.action === "add_status_page_update" && s.affectionStatus === "mitigating"),
				],
			},
			{
				name: "Turn 3: Fully recovered — suggest resolved status-page update",
				context: {
					incident: baseIncident({ ...incidentBase, status: "mitigating", severity: "high" }),
					services: SERVICES,
					affection: { hasAffection: true, lastStatus: "mitigating" },
					events: t3Events,
					processedThroughId: t3ProcessedThrough,
					validStatusTransitions: ["resolved"],
				},
				checks: [shouldSuggest("add_status_page_update", (s) => s.action === "add_status_page_update" && s.affectionStatus === "resolved")],
			},
		],
	};
}

// ---------------------------------------------------------------------------
// Scenario 11: Real incident replay — API performance degradation
// ---------------------------------------------------------------------------

function buildRealPerformanceIncidentScenario(): LifecycleScenario {
	const USERS = {
		reporter: "U_FAKE_REPORTER",
		oncall: "U_FAKE_ONCALL",
		engineerA: "U_FAKE_ENG_A",
		engineerB: "U_FAKE_ENG_B",
	};
	const SERVICES: AgentSuggestionContext["services"] = [
		{ id: "00000000-0000-4000-8000-000000000101", name: "API", prompt: "Public API" },
		{ id: "00000000-0000-4000-8000-000000000102", name: "Web", prompt: "Web app" },
	];

	const incidentBase = {
		title: "Performance issues reported",
		description: "API slowness and intermittent errors, with instance health-check instability.",
		prompt: "We are having some performance issues",
	};

	/**
	 * Pattern-matched historical outcomes from the real incident log:
	 *
	 * Approved-like suggestions (matched later applied events):
	 * - update_severity=high (later SEVERITY_UPDATE high)
	 * - update_status=mitigating (later STATUS_UPDATE mitigating)
	 * - add_status_page_update investigating "API degradation..." (later AFFECTION_UPDATE investigating)
	 * - add_status_page_update root-cause autoscaling delay (later AFFECTION_UPDATE matching update)
	 * - update_status=resolved (later STATUS_UPDATE resolved)
	 * - add_status_page_update resolved (later AFFECTION_UPDATE resolved)
	 *
	 * Not-approved-like suggestions (no matching apply event, superseded, or duplicate/noisy):
	 * - early update_status=resolved while incident was still active
	 * - repeated update_status=mitigating / update_severity=high duplicates
	 * - repeated near-duplicate investigating status-page updates without material new info
	 */

	// Turn 1: early contradictory chat; a prior bad "resolved" suggestion exists but was not applied.
	resetIds();
	const t1Events: AgentEvent[] = [
		mkEvent(
			{
				event_type: "INCIDENT_CREATED",
				event_data: {
					status: "open",
					severity: "medium",
					createdBy: USERS.reporter,
					...incidentBase,
					source: "slack",
					assignee: USERS.oncall,
					entryPointId: "00000000-0000-4000-8000-00000000e001",
					rotationId: "00000000-0000-4000-8000-00000000d001",
				},
			},
			0,
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "esta ok", userId: USERS.oncall } }, 3),
		mkSuggestionEvent({ action: "update_status", status: "resolved", message: "Reporter indicates performance is OK now; closing incident." }, 4, "sug_real_bad_1"),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "No esta ok", userId: USERS.engineerA } }, 5),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "hi ha un munt de cors errors", userId: USERS.reporter } }, 6),
	];

	// Turn 2: confirmed impact and scope; should move to mitigating/high and first public update.
	resetIds();
	const t2Events: AgentEvent[] = [
		...t1Events,
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Hi ha dos instàncies mortes", userId: USERS.engineerB } }, 8),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Si, es api que va molt lent, la bbdd esta ok", userId: USERS.engineerA } }, 9),
	];
	const t2ProcessedThrough = t1Events[t1Events.length - 1]!.id;

	// Turn 3: approved mitigating/high/first investigating update already happened; avoid noisy duplicate updates.
	resetIds();
	const t3Events: AgentEvent[] = [
		...t2Events,
		mkSuggestionEvent({ action: "update_severity", severity: "high" }, 10, "sug_real_ok_1"),
		mkEvent({ event_type: "SEVERITY_UPDATE", event_data: { severity: "high" } }, 11),
		mkSuggestionEvent(
			{ action: "update_status", status: "mitigating", message: "Confirmed core errors; team investigating/mitigating (possibly API-related)." },
			12,
			"sug_real_ok_2",
		),
		mkEvent({ event_type: "STATUS_UPDATE", event_data: { status: "mitigating", message: "Confirmed core errors; team investigating/mitigating (possibly API-related)." } }, 13),
		mkSuggestionEvent(
			{
				action: "add_status_page_update",
				affectionStatus: "investigating",
				title: "API degradation causing slow responses",
				message: "Investigating degraded performance and elevated error rates; some API instances are down causing slow responses.",
				services: [{ id: "00000000-0000-4000-8000-000000000101", impact: "major" }],
			},
			14,
			"sug_real_ok_3",
		),
		mkEvent(
			{
				event_type: "AFFECTION_UPDATE",
				event_data: {
					status: "investigating",
					title: "API degradation causing slow responses",
					message: "Investigating degraded performance and elevated error rates; some API instances are down causing slow responses.",
					services: [{ id: "00000000-0000-4000-8000-000000000101", impact: "major" }],
					createdBy: USERS.engineerA,
				},
			},
			15,
		),
		mkSuggestionEvent(
			{
				action: "add_status_page_update",
				affectionStatus: "investigating",
				title: "Ongoing API performance degradation",
				message: "Performance is still degraded. Sustained high CPU on API instances; mitigation continues.",
				services: [{ id: "00000000-0000-4000-8000-000000000101", impact: "major" }],
			},
			16,
			"sug_real_bad_2",
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Has de mirar aixo, que no hi hagi errors no vol dir que funcioni bé", userId: USERS.engineerA } }, 17),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "No sustained", userId: USERS.engineerA } }, 18),
	];
	const t3ProcessedThrough = t3Events[t3Events.length - 3]!.id;

	// Turn 4: materially new root-cause insight; should suggest a substantive public update.
	resetIds();
	const t4Events: AgentEvent[] = [
		...t3Events,
		mkEvent(
			{
				event_type: "AFFECTION_UPDATE",
				event_data: {
					status: "mitigating",
					title: "Monitoring API instance health",
					message: "Added additional API capacity and monitoring instance health; performance improving.",
					services: [{ id: "00000000-0000-4000-8000-000000000101", impact: "major" }],
					createdBy: "fire",
				},
			},
			20,
		),
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: {
					message: "si, es q al escalar han fallat 2 instancies el health check i no ha pogut escalar fins q les ha recuperat, pel q anava retrassat",
					userId: USERS.oncall,
				},
			},
			21,
		),
	];
	const t4ProcessedThrough = t3Events[t3Events.length - 1]!.id;

	// Turn 5: final human all-clear; should close incident and publish resolved update.
	resetIds();
	const t5Events: AgentEvent[] = [
		...t4Events,
		mkSuggestionEvent(
			{
				action: "add_status_page_update",
				title: "Update: autoscaling delay due to health check failures",
				message:
					"We believe degradation was triggered during autoscaling: two API instances failed health checks, delaying scale-out until recovered. Capacity has been added and we continue monitoring.",
				services: [{ id: "00000000-0000-4000-8000-000000000101", impact: "major" }],
			},
			22,
			"sug_real_ok_4",
		),
		mkEvent(
			{
				event_type: "AFFECTION_UPDATE",
				event_data: {
					title: "Update: autoscaling delay due to health check failures",
					message:
						"We believe degradation was triggered during autoscaling: two API instances failed health checks, delaying scale-out until recovered. Capacity has been added and we continue monitoring.",
					services: [{ id: "00000000-0000-4000-8000-000000000101", impact: "major" }],
					createdBy: USERS.oncall,
				},
			},
			23,
		),
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: {
					message: "Yup all good, per mi tanquem, ara passo el link del postmortem q generi :)",
					userId: USERS.oncall,
				},
			},
			24,
		),
	];
	const t5ProcessedThrough = t5Events[t5Events.length - 2]!.id;

	return {
		id: "real-performance",
		name: "Real Incident: API Performance Degradation",
		description: "Replay of a real incident with early false-resolve noise, approved mitigating/high transitions, status-page spam risk, and final close.",
		turns: [
			{
				name: "Turn 1: Conflicting early signals — do not resolve",
				context: {
					incident: baseIncident({ ...incidentBase, severity: "medium" }),
					services: SERVICES,
					affection: { hasAffection: false },
					events: t1Events,
					processedThroughId: 0,
					validStatusTransitions: ["mitigating", "resolved"],
				},
				checks: [shouldNotSuggest("update_status", (s) => s.action === "update_status" && s.status === "resolved")],
			},
			{
				name: "Turn 2: Confirmed impact — suggest mitigating/high and first public update",
				context: {
					incident: baseIncident({ ...incidentBase, severity: "medium" }),
					services: SERVICES,
					affection: { hasAffection: false },
					events: t2Events,
					processedThroughId: t2ProcessedThrough,
					validStatusTransitions: ["mitigating", "resolved"],
				},
				checks: [
					shouldSuggest("update_status", (s) => s.action === "update_status" && s.status === "mitigating"),
					shouldSuggest("update_severity", (s) => s.action === "update_severity" && s.severity === "high"),
					shouldSuggest("add_status_page_update", (s) => s.action === "add_status_page_update" && s.affectionStatus === "investigating"),
				],
			},
			{
				name: "Turn 3: Ongoing noise with no material new external info — avoid duplicates",
				context: {
					incident: baseIncident({ ...incidentBase, status: "mitigating", severity: "high" }),
					services: SERVICES,
					affection: { hasAffection: true, lastStatus: "investigating" },
					events: t3Events,
					processedThroughId: t3ProcessedThrough,
					validStatusTransitions: ["resolved"],
				},
				checks: [
					shouldNotSuggest("update_status", (s) => s.action === "update_status" && s.status === "mitigating"),
					shouldNotSuggest("update_severity", (s) => s.action === "update_severity" && s.severity === "high"),
					shouldNotSuggest("add_status_page_update"),
				],
			},
			{
				name: "Turn 4: Root-cause insight and capacity update — suggest public update",
				context: {
					incident: baseIncident({ ...incidentBase, status: "mitigating", severity: "high" }),
					services: SERVICES,
					affection: { hasAffection: true, lastStatus: "mitigating" },
					events: t4Events,
					processedThroughId: t4ProcessedThrough,
					validStatusTransitions: ["resolved"],
				},
				checks: [shouldSuggest("add_status_page_update"), shouldNotSuggest("update_status", (s) => s.action === "update_status" && s.status === "resolved")],
			},
			{
				name: "Turn 5: Human all-clear — suggest resolved + resolved status-page update",
				context: {
					incident: baseIncident({ ...incidentBase, status: "mitigating", severity: "high" }),
					services: SERVICES,
					affection: { hasAffection: true, lastStatus: "mitigating" },
					events: t5Events,
					processedThroughId: t5ProcessedThrough,
					validStatusTransitions: ["resolved"],
				},
				checks: [
					shouldSuggest("update_status", (s) => s.action === "update_status" && s.status === "resolved"),
					shouldSuggest("add_status_page_update", (s) => s.action === "add_status_page_update" && s.affectionStatus === "resolved"),
				],
			},
		],
	};
}

// ---------------------------------------------------------------------------
// Scenario 12: Pending first status-page suggestion must not spam investigating
// ---------------------------------------------------------------------------

function buildPendingInvestigatingSpamScenario(): LifecycleScenario {
	const SERVICES: AgentSuggestionContext["services"] = [{ id: "svc_enrich", name: "Enrich", prompt: "Enrichments are stuck, not processing, lost or failing" }];

	const incidentBase = {
		title: "Customers see 'Failed to start enrichment' error",
		description: "Multiple customers report enrichment start failures in production.",
		prompt: "Some customers reported `Failed to start enrichment`.",
	};

	resetIds();
	const t1Events: AgentEvent[] = [
		mkEvent(
			{
				event_type: "INCIDENT_CREATED",
				event_data: {
					status: "open",
					severity: "medium",
					createdBy: "U_ONCALL",
					...incidentBase,
					source: "slack",
					assignee: "U_ONCALL",
					entryPointId: "ep_enrich",
					rotationId: "rot_enrich",
				},
			},
			0,
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Multiple customers report `Failed to start enrichment`.", userId: "U_REPORTER" } }, 2),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Reproduced in production account. Investigating.", userId: "U_ONCALL" } }, 4),
	];

	resetIds();
	const t2Events: AgentEvent[] = [
		...t1Events,
		mkSuggestionEvent(
			{
				action: "add_status_page_update",
				message: "We’re investigating reports of enrichments failing to start.",
				affectionStatus: "investigating",
				title: "Enrichments failing to start",
				services: [{ id: "svc_enrich", impact: "partial" }],
			},
			6,
			"sug_enrich_sp_1",
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Could this be related to AI variables? Not confirmed yet.", userId: "U_ENG_A" } }, 8),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "No code changes found yet in this area.", userId: "U_ENG_B" } }, 9),
	];
	const t2ProcessedThrough = t1Events[t1Events.length - 1]!.id;

	resetIds();
	const t3Events: AgentEvent[] = [
		...t2Events,
		mkSuggestionEvent(
			{
				action: "add_status_page_update",
				message: "We’re investigating reports of enrichments failing to start.",
				affectionStatus: "investigating",
				title: "Enrichments failing to start",
				services: [{ id: "svc_enrich", impact: "partial" }],
			},
			10,
			"sug_enrich_sp_2",
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Still investigating root cause. No confirmed external change.", userId: "U_ONCALL" } }, 11),
	];
	const t3ProcessedThrough = t2Events[t2Events.length - 1]!.id;

	resetIds();
	const t4Events: AgentEvent[] = [
		...t3Events,
		mkSuggestionEvent(
			{
				action: "add_status_page_update",
				message: "Investigating ongoing enrichment start failures.",
				affectionStatus: "investigating",
				title: "Enrichments failing to start",
				services: [{ id: "svc_enrich", impact: "partial" }],
			},
			12,
			"sug_enrich_sp_3",
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Any new externally visible impact? not yet.", userId: "U_ENG_A" } }, 13),
	];
	const t4ProcessedThrough = t3Events[t3Events.length - 1]!.id;

	return {
		id: "pending-investigating-spam",
		name: "Status Page: Pending Investigating Suggestion Should Not Spam",
		description: "When first status-page suggestion is pending (no AFFECTION_UPDATE yet), later turns with no new external facts must not re-suggest add_status_page_update.",
		turns: [
			{
				name: "Turn 1: Confirmed external impact — first investigating update is allowed",
				context: {
					incident: baseIncident({ ...incidentBase, severity: "medium" }),
					services: SERVICES,
					affection: { hasAffection: false },
					events: t1Events,
					processedThroughId: 0,
					validStatusTransitions: ["mitigating", "resolved"],
				},
				checks: [shouldSuggest("add_status_page_update", (s) => s.action === "add_status_page_update" && s.affectionStatus === "investigating")],
			},
			{
				name: "Turn 2: Pending first suggestion + internal chatter — do not re-suggest status page",
				context: {
					incident: baseIncident({ ...incidentBase, severity: "medium" }),
					services: SERVICES,
					affection: { hasAffection: false },
					events: t2Events,
					processedThroughId: t2ProcessedThrough,
					validStatusTransitions: ["mitigating", "resolved"],
				},
				checks: [shouldNotSuggest("add_status_page_update")],
			},
			{
				name: "Turn 3: Second duplicate already exists + no new external fact — still no status page suggestion",
				context: {
					incident: baseIncident({ ...incidentBase, severity: "medium" }),
					services: SERVICES,
					affection: { hasAffection: false },
					events: t3Events,
					processedThroughId: t3ProcessedThrough,
					validStatusTransitions: ["mitigating", "resolved"],
				},
				checks: [shouldNotSuggest("add_status_page_update")],
			},
			{
				name: "Turn 4: Third duplicate in history + no external delta — must stay silent",
				context: {
					incident: baseIncident({ ...incidentBase, severity: "medium" }),
					services: SERVICES,
					affection: { hasAffection: false },
					events: t4Events,
					processedThroughId: t4ProcessedThrough,
					validStatusTransitions: ["mitigating", "resolved"],
				},
				checks: [shouldNotSuggest("add_status_page_update")],
			},
		],
	};
}

// ---------------------------------------------------------------------------
// Scenario 13: Many small turns should stay quiet unless external delta exists
// ---------------------------------------------------------------------------

function buildMicroTurnNoiseScenario(): LifecycleScenario {
	const SERVICES: AgentSuggestionContext["services"] = [{ id: "svc_enrich", name: "Enrich", prompt: "Enrichments are stuck, not processing, lost or failing" }];

	const incidentBase = {
		title: "Enrichment start failures",
		description: "Customers report `Failed to start enrichment` errors.",
		prompt: "Investigate enrichment start failures affecting customers.",
	};

	resetIds();
	const t1Events: AgentEvent[] = [
		mkEvent(
			{
				event_type: "INCIDENT_CREATED",
				event_data: {
					status: "open",
					severity: "medium",
					createdBy: "U_ONCALL",
					...incidentBase,
					source: "slack",
					assignee: "U_ONCALL",
					entryPointId: "ep_enrich",
					rotationId: "rot_enrich",
				},
			},
			0,
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Multiple customers report `Failed to start enrichment`.", userId: "U_REPORTER" } }, 2),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Confirmed in production accounts. External impact is real.", userId: "U_ONCALL" } }, 3),
	];

	const t2Events: AgentEvent[] = [
		...t1Events,
		mkSuggestionEvent(
			{
				action: "add_status_page_update",
				message: "We are investigating reports of enrichments failing to start.",
				affectionStatus: "investigating",
				title: "Enrichments failing to start",
				services: [{ id: "svc_enrich", impact: "partial" }],
			},
			5,
			"sug_micro_1",
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Testing locally to find exact stack trace.", userId: "U_ENG_A" } }, 6),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "No confirmed external change yet.", userId: "U_ENG_B" } }, 7),
	];
	const t2ProcessedThrough = t1Events[t1Events.length - 1]!.id;

	const t3Events: AgentEvent[] = [
		...t2Events,
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Datadog error candidate shared, still validating.", userId: "U_ONCALL" } }, 8),
	];
	const t3ProcessedThrough = t2Events[t2Events.length - 1]!.id;

	const t4Events: AgentEvent[] = [
		...t3Events,
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: {
					message: "Potential internal trigger: field-name conflict path in useEnrichmentsModal. Not externally confirmed yet.",
					userId: "U_ENG_A",
				},
			},
			9,
		),
	];
	const t4ProcessedThrough = t3Events[t3Events.length - 1]!.id;

	const t5Events: AgentEvent[] = [
		...t4Events,
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Still debugging, no user-facing update beyond investigating.", userId: "U_ENG_B" } }, 10),
	];
	const t5ProcessedThrough = t4Events[t4Events.length - 1]!.id;

	const t6Events: AgentEvent[] = [...t5Events, mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "No recent deploy in that code path.", userId: "U_ONCALL" } }, 11)];
	const t6ProcessedThrough = t5Events[t5Events.length - 1]!.id;

	const t7Events: AgentEvent[] = [
		...t6Events,
		mkEvent(
			{
				event_type: "MESSAGE_ADDED",
				event_data: {
					message:
						"New external fact confirmed: failures occur when AI variable name conflicts with an existing field. Support workaround shared: rename the variable to continue enrichment while fix is prepared.",
					userId: "U_ONCALL",
				},
			},
			12,
		),
	];
	const t7ProcessedThrough = t6Events[t6Events.length - 1]!.id;

	const t8Events: AgentEvent[] = [
		...t7Events,
		mkSuggestionEvent(
			{
				action: "add_status_page_update",
				message: "We identified a trigger and shared a workaround while we prepare a fix.",
			},
			13,
			"sug_micro_2",
		),
		mkEvent({ event_type: "MESSAGE_ADDED", event_data: { message: "Engineering is implementing better validation copy.", userId: "U_ENG_A" } }, 14),
	];
	const t8ProcessedThrough = t7Events[t7Events.length - 1]!.id;

	return {
		id: "micro-turn-noise",
		name: "Micro Turns: Avoid Noise Across Small Turns",
		description:
			"Simulates many small incident turns where most updates are internal chatter. Agent should avoid repeating status-page suggestions until there is a genuine new external-facing fact.",
		turns: [
			{
				name: "Turn 1: Initial confirmed impact - first investigating status page update",
				context: {
					incident: baseIncident({ ...incidentBase, severity: "medium" }),
					services: SERVICES,
					affection: { hasAffection: false },
					events: t1Events,
					processedThroughId: 0,
					validStatusTransitions: ["mitigating", "resolved"],
				},
				checks: [shouldSuggest("add_status_page_update", (s) => s.action === "add_status_page_update" && s.affectionStatus === "investigating")],
			},
			{
				name: "Turn 2: Small internal chatter - no additional status-page suggestion",
				context: {
					incident: baseIncident({ ...incidentBase, severity: "medium" }),
					services: SERVICES,
					affection: { hasAffection: false },
					events: t2Events,
					processedThroughId: t2ProcessedThrough,
					validStatusTransitions: ["mitigating", "resolved"],
				},
				checks: [shouldNotSuggest("add_status_page_update")],
			},
			{
				name: "Turn 3: Another tiny turn - still no status-page suggestion",
				context: {
					incident: baseIncident({ ...incidentBase, severity: "medium" }),
					services: SERVICES,
					affection: { hasAffection: false },
					events: t3Events,
					processedThroughId: t3ProcessedThrough,
					validStatusTransitions: ["mitigating", "resolved"],
				},
				checks: [shouldNotSuggest("add_status_page_update")],
			},
			{
				name: "Turn 4: Internal hypothesis only - no status-page suggestion",
				context: {
					incident: baseIncident({ ...incidentBase, severity: "medium" }),
					services: SERVICES,
					affection: { hasAffection: false },
					events: t4Events,
					processedThroughId: t4ProcessedThrough,
					validStatusTransitions: ["mitigating", "resolved"],
				},
				checks: [shouldNotSuggest("add_status_page_update")],
			},
			{
				name: "Turn 5: No external delta - no status-page suggestion",
				context: {
					incident: baseIncident({ ...incidentBase, severity: "medium" }),
					services: SERVICES,
					affection: { hasAffection: false },
					events: t5Events,
					processedThroughId: t5ProcessedThrough,
					validStatusTransitions: ["mitigating", "resolved"],
				},
				checks: [shouldNotSuggest("add_status_page_update")],
			},
			{
				name: "Turn 6: Still internal debugging - no status-page suggestion",
				context: {
					incident: baseIncident({ ...incidentBase, severity: "medium" }),
					services: SERVICES,
					affection: { hasAffection: false },
					events: t6Events,
					processedThroughId: t6ProcessedThrough,
					validStatusTransitions: ["mitigating", "resolved"],
				},
				checks: [shouldNotSuggest("add_status_page_update")],
			},
			{
				name: "Turn 7: New external-facing fact + workaround - suggest status-page update",
				context: {
					incident: baseIncident({ ...incidentBase, severity: "medium" }),
					services: SERVICES,
					affection: { hasAffection: false },
					events: t7Events,
					processedThroughId: t7ProcessedThrough,
					validStatusTransitions: ["mitigating", "resolved"],
				},
				checks: [shouldSuggest("add_status_page_update")],
			},
			{
				name: "Turn 8: After follow-up suggestion with no new delta - stay quiet",
				context: {
					incident: baseIncident({ ...incidentBase, severity: "medium" }),
					services: SERVICES,
					affection: { hasAffection: false },
					events: t8Events,
					processedThroughId: t8ProcessedThrough,
					validStatusTransitions: ["mitigating", "resolved"],
				},
				checks: [shouldNotSuggest("add_status_page_update")],
			},
		],
	};
}

// ---------------------------------------------------------------------------
// All scenarios
// ---------------------------------------------------------------------------

export const SCENARIOS: LifecycleScenario[] = [
	buildWebIncidentScenario(),
	buildApiIncidentScenario(),
	buildBackgroundJobsScenario(),
	buildInternalIncidentScenario(),
	buildVagueReportScenario(),
	buildNoisyAlertsScenario(),
	buildSeverityScenario(),
	buildStatusPageUpdatesScenario(),
	buildRepeatWithDeltaScenario(),
	buildFirstStatusPageInvestigatingScenario(),
	buildRealPerformanceIncidentScenario(),
	buildPendingInvestigatingSpamScenario(),
	buildMicroTurnNoiseScenario(),
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export type EvalOptions = {
	systemPrompt?: string;
	apiKey?: string;
	model?: string;
	judgeModel?: string;
	runs?: number;
	verbose?: boolean;
	out?: string;
	skipJudge?: boolean;
	reasoningEffort?: ReasoningEffort;
};

type TurnRunCapture = {
	runIndex: number;
	responseId?: string;
	usage?: ModelUsage;
	toolCalls: ModelToolCall[];
	rawSuggestions: AgentSuggestion[];
	suggestions: AgentSuggestion[];
	durationMs: number;
};

type TurnCapture = {
	name: string;
	expectations: string[];
	context: AgentSuggestionContext;
	input: InputMessage[];
	tools: ResponsesToolDef[];
	runs: TurnRunCapture[];
};

type ScenarioCapture = {
	id: string;
	name: string;
	description: string;
	turns: TurnCapture[];
	totalDurationMs: number;
};

type EvaluationArtifact = {
	version: 3;
	createdAt: string;
	model: string;
	systemPrompt: string;
	judgeModel?: string;
	runsPerTurn: number;
	scenarios: ScenarioCapture[];
	metrics?: EvaluationMetricsSummary;
	judgement?: EvaluationJudgementSummary;
};

type EvaluationMetricsSummary = {
	totalTurns: number;
	totalRuns: number;
	totalSuggestions: number;
	totalExpectations: number;
	positiveExpectations: number;
	negativeExpectations: number;
	expectationPassRate: number;
	positiveRecall: number;
	precisionProxy: number;
	negativeViolationRate: number;
	resolvedSuggestions: number;
	invalidResolvedSuggestions: number;
	falseResolvedRate: number;
	duplicateSuggestionRate: number;
	firstStatusPageSuggestions: number;
	firstStatusPageCompliant: number;
	firstStatusPageComplianceRate: number;
};

type JudgedExpectation = {
	expectation: string;
	result: "met" | "not_met" | "unclear";
	reason: string;
};

type TurnJudgement = {
	overall: "strong" | "acceptable" | "poor";
	score: number;
	summary: string;
	expectations: JudgedExpectation[];
	positives: string[];
	issues: string[];
};

type TurnJudgementRecord = {
	scenarioId: string;
	scenarioName: string;
	turnName: string;
	runIndex: number;
	durationMs: number;
	judgement: TurnJudgement;
};

type EvaluationJudgementSummary = {
	model: string;
	createdAt: string;
	totalEvaluatedRuns: number;
	averageScore: number;
	overallCounts: { strong: number; acceptable: number; poor: number };
	results: TurnJudgementRecord[];
};

type JudgeFunctionOutput = {
	overall: "strong" | "acceptable" | "poor";
	score: number;
	summary: string;
	expectations: Array<{ expectation: string; result: "met" | "not_met" | "unclear"; reason: string }>;
	positives: string[];
	issues: string[];
};

function buildDefaultOutputPath(): string {
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	return resolve("/tmp", `incident-agent-eval-${stamp}.json`);
}

async function writeArtifact(path: string, artifact: EvaluationArtifact): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
}

async function readArtifact(path: string): Promise<EvaluationArtifact> {
	const content = await readFile(path, "utf8");
	return JSON.parse(content) as EvaluationArtifact;
}

type ExpectationConstraint = { field: "status" | "severity" | "affectionStatus"; values: string[] };
type ExpectationRule = { raw: string; isNegative: boolean; action: AgentSuggestion["action"]; constraints: ExpectationConstraint[] };

function parseExpectationRule(expectation: string): ExpectationRule | null {
	const match = expectation.trim().match(/^Should( NOT)? suggest ([a-z_]+)(?: \((.+)\))?\.$/);
	if (!match) {
		return null;
	}
	const isNegative = Boolean(match[1]);
	const action = match[2] as AgentSuggestion["action"];
	const detail = match[3] ?? "";
	const constraints: ExpectationConstraint[] = [];
	const addConstraint = (field: "status" | "severity" | "affectionStatus", values: string[]) => {
		const filtered = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
		if (filtered.length) {
			constraints.push({ field, values: filtered });
		}
	};

	for (const inMatch of detail.matchAll(/\b(status|severity|affectionStatus)\s+in\s+\[([^\]]+)\]/g)) {
		addConstraint(inMatch[1] as "status" | "severity" | "affectionStatus", inMatch[2]!.split(","));
	}
	for (const eqMatch of detail.matchAll(/\b(status|severity|affectionStatus)=([a-z_]+)/g)) {
		addConstraint(eqMatch[1] as "status" | "severity" | "affectionStatus", [eqMatch[2]!]);
	}

	return { raw: expectation, isNegative, action, constraints };
}

function getSuggestionConstraintValue(suggestion: AgentSuggestion, field: "status" | "severity" | "affectionStatus"): string | null {
	if (field === "status") {
		return suggestion.action === "update_status" ? suggestion.status : null;
	}
	if (field === "severity") {
		return suggestion.action === "update_severity" ? suggestion.severity : null;
	}
	return suggestion.action === "add_status_page_update" && suggestion.affectionStatus ? suggestion.affectionStatus : null;
}

function matchesExpectationRule(suggestion: AgentSuggestion, rule: ExpectationRule): boolean {
	if (suggestion.action !== rule.action) {
		return false;
	}
	for (const constraint of rule.constraints) {
		const value = getSuggestionConstraintValue(suggestion, constraint.field);
		if (!value || !constraint.values.includes(value)) {
			return false;
		}
	}
	return true;
}

function buildSuggestionSignatureForMetrics(suggestion: AgentSuggestion): string {
	switch (suggestion.action) {
		case "update_status":
			return `update_status:${suggestion.status}`;
		case "update_severity":
			return `update_severity:${suggestion.severity}`;
		case "add_status_page_update": {
			const status = suggestion.affectionStatus ?? "none";
			const services = suggestion.services?.length
				? suggestion.services
						.map((service) => `${service.id}:${service.impact}`)
						.sort()
						.join("|")
				: "none";
			return `add_status_page_update:${status}:${services}`;
		}
	}
}

function computeDeterministicMetrics(artifact: EvaluationArtifact): EvaluationMetricsSummary {
	let totalTurns = 0;
	let totalRuns = 0;
	let totalSuggestions = 0;
	let totalExpectations = 0;
	let positiveExpectations = 0;
	let negativeExpectations = 0;
	let metExpectations = 0;
	let metPositive = 0;
	let unsupportedSuggestions = 0;
	let negativeViolations = 0;
	let resolvedSuggestions = 0;
	let invalidResolvedSuggestions = 0;
	let duplicateSuggestions = 0;
	let firstStatusPageSuggestions = 0;
	let firstStatusPageCompliant = 0;

	for (const scenario of artifact.scenarios) {
		const duplicateStateByRun = new Map<number, Set<string>>();
		for (const turn of scenario.turns) {
			totalTurns += 1;
			const parsedRules = turn.expectations.map(parseExpectationRule).filter((rule): rule is ExpectationRule => !!rule);
			for (const run of turn.runs) {
				totalRuns += 1;
				const suggestions = run.suggestions;
				totalSuggestions += suggestions.length;
				totalExpectations += parsedRules.length;

				const positiveRules = parsedRules.filter((rule) => !rule.isNegative);
				const negativeRules = parsedRules.filter((rule) => rule.isNegative);
				positiveExpectations += positiveRules.length;
				negativeExpectations += negativeRules.length;

				for (const rule of positiveRules) {
					if (suggestions.some((suggestion) => matchesExpectationRule(suggestion, rule))) {
						metExpectations += 1;
						metPositive += 1;
					}
				}
				for (const rule of negativeRules) {
					const violated = suggestions.some((suggestion) => matchesExpectationRule(suggestion, rule));
					if (!violated) {
						metExpectations += 1;
					} else {
						negativeViolations += 1;
					}
				}

				for (const suggestion of suggestions) {
					const matchesAnyPositive = positiveRules.some((rule) => matchesExpectationRule(suggestion, rule));
					if (!matchesAnyPositive) {
						unsupportedSuggestions += 1;
					}

					if (suggestion.action === "update_status" && suggestion.status === "resolved") {
						resolvedSuggestions += 1;
						const resolvedAllowed = positiveRules.some((rule) => matchesExpectationRule(suggestion, rule));
						if (!resolvedAllowed) {
							invalidResolvedSuggestions += 1;
						}
					}

					if (!turn.context.affection.hasAffection && suggestion.action === "add_status_page_update") {
						firstStatusPageSuggestions += 1;
						if (suggestion.affectionStatus === "investigating" && suggestion.title?.trim() && suggestion.services?.length) {
							firstStatusPageCompliant += 1;
						}
					}
				}

				const runDuplicateState = duplicateStateByRun.get(run.runIndex) ?? new Set<string>();
				duplicateStateByRun.set(run.runIndex, runDuplicateState);
				for (const suggestion of suggestions) {
					const signature = buildSuggestionSignatureForMetrics(suggestion);
					if (!runDuplicateState.has(signature)) {
						runDuplicateState.add(signature);
						continue;
					}
					duplicateSuggestions += 1;
				}
			}
		}
	}

	const expectationPassRate = totalExpectations ? metExpectations / totalExpectations : 0;
	const positiveRecall = positiveExpectations ? metPositive / positiveExpectations : 0;
	const precisionProxy = metPositive + unsupportedSuggestions ? metPositive / (metPositive + unsupportedSuggestions) : 1;
	const negativeViolationRate = negativeExpectations ? negativeViolations / negativeExpectations : 0;
	const falseResolvedRate = resolvedSuggestions ? invalidResolvedSuggestions / resolvedSuggestions : 0;
	const duplicateSuggestionRate = totalSuggestions ? duplicateSuggestions / totalSuggestions : 0;
	const firstStatusPageComplianceRate = firstStatusPageSuggestions ? firstStatusPageCompliant / firstStatusPageSuggestions : 1;

	return {
		totalTurns,
		totalRuns,
		totalSuggestions,
		totalExpectations,
		positiveExpectations,
		negativeExpectations,
		expectationPassRate,
		positiveRecall,
		precisionProxy,
		negativeViolationRate,
		resolvedSuggestions,
		invalidResolvedSuggestions,
		falseResolvedRate,
		duplicateSuggestionRate,
		firstStatusPageSuggestions,
		firstStatusPageCompliant,
		firstStatusPageComplianceRate,
	};
}

function toJudgePayload(turn: TurnCapture, run: TurnRunCapture) {
	const events = turn.context.events.map((event) => ({
		id: event.id,
		type: event.event_type,
		createdAt: event.created_at,
		data: event.event_data,
		metadata: event.event_metadata,
	}));

	return {
		turnName: turn.name,
		expectations: turn.expectations,
		incident: turn.context.incident,
		affection: turn.context.affection,
		validStatusTransitions: turn.context.validStatusTransitions,
		processedThroughId: turn.context.processedThroughId ?? 0,
		events,
		modelSuggestions: run.suggestions,
		modelRawSuggestions: run.rawSuggestions,
		modelToolCalls: run.toolCalls,
		modelUsage: run.usage ?? null,
	};
}

async function judgeTurnWithLLM(payload: ReturnType<typeof toJudgePayload>, apiKey: string, judgeModel: string): Promise<TurnJudgement> {
	const judgeTool: ResponsesToolDef = {
		type: "function",
		name: "grade_turn",
		description: "Grade whether the model suggestions satisfy the written expectations for this turn.",
		parameters: {
			type: "object",
			properties: {
				overall: { type: "string", enum: ["strong", "acceptable", "poor"] },
				score: { type: "number", minimum: 0, maximum: 1 },
				summary: { type: "string" },
				expectations: {
					type: "array",
					items: {
						type: "object",
						properties: {
							expectation: { type: "string" },
							result: { type: "string", enum: ["met", "not_met", "unclear"] },
							reason: { type: "string" },
						},
						required: ["expectation", "result", "reason"],
						additionalProperties: false,
					},
				},
				positives: { type: "array", items: { type: "string" } },
				issues: { type: "array", items: { type: "string" } },
			},
			required: ["overall", "score", "summary", "expectations", "positives", "issues"],
			additionalProperties: false,
		},
	};

	const judgeInput: InputMessage[] = [
		{
			type: "message",
			role: "system",
			content:
				"You are grading an incident-agent turn. Use written expectations as the rubric. Treat modelSuggestions as the final accepted suggestions to score. modelRawSuggestions/modelToolCalls are diagnostic only. Do not invent facts. Call grade_turn exactly once.",
		},
		{
			type: "message",
			role: "user",
			content: JSON.stringify(payload),
		},
	];

	const response = await fetch("https://api.openai.com/v1/responses", {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
		body: JSON.stringify({ model: judgeModel, input: judgeInput, tools: [judgeTool], tool_choice: "auto" }),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Judge model API error ${response.status}: ${text}`);
	}

	const data = (await response.json()) as ResponsesCreateResponse;
	const toolCall = (data.output ?? []).find((item) => item.type === "function_call" && item.name === "grade_turn");
	if (!toolCall?.arguments) {
		throw new Error("Judge model did not return grade_turn output");
	}

	const parsed = JSON.parse(toolCall.arguments) as JudgeFunctionOutput;
	const normalizedScore = Number.isFinite(parsed.score) ? Math.min(1, Math.max(0, parsed.score)) : 0;

	return {
		overall: parsed.overall ?? "poor",
		score: normalizedScore,
		summary: parsed.summary ?? "",
		expectations: Array.isArray(parsed.expectations)
			? parsed.expectations.map((item) => ({
					expectation: item.expectation ?? "",
					result: item.result ?? "unclear",
					reason: item.reason ?? "",
				}))
			: [],
		positives: Array.isArray(parsed.positives) ? parsed.positives : [],
		issues: Array.isArray(parsed.issues) ? parsed.issues : [],
	};
}

async function runTurn(turn: Turn, opts: EvalOptions): Promise<TurnCapture> {
	const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
	if (!apiKey) throw new Error("OPENAI_API_KEY is required");
	const model = opts.model ?? "gpt-5.2";
	const runs = opts.runs ?? 1;

	const input = buildFullInput(turn.context, { systemPrompt: opts.systemPrompt });
	const tools = toResponsesTools(buildSuggestionTools(turn.context));

	if (opts.verbose) {
		console.log(`\n    --- Messages for: ${turn.name} ---`);
		for (const msg of input) {
			console.log(`      [${msg.role}] ${msg.content.slice(0, 200)}${msg.content.length > 200 ? "..." : ""}`);
		}
		console.log("    ---\n");
	}

	const runCaptures: TurnRunCapture[] = [];
	for (let runIndex = 1; runIndex <= runs; runIndex += 1) {
		const start = Date.now();
		const result = await callOpenAI(input, tools, apiKey, model, opts.reasoningEffort ?? "medium");
		const durationMs = Date.now() - start;
		const normalizedSuggestions = normalizeSuggestions(result.suggestions, turn.context);
		runCaptures.push({
			runIndex,
			responseId: result.responseId,
			usage: result.usage,
			toolCalls: result.toolCalls,
			rawSuggestions: result.suggestions,
			suggestions: normalizedSuggestions,
			durationMs,
		});
	}

	return {
		name: turn.name,
		expectations: turn.checks,
		context: turn.context,
		input,
		tools,
		runs: runCaptures,
	};
}

async function runLifecycleScenario(scenario: LifecycleScenario, opts: EvalOptions): Promise<ScenarioCapture> {
	const turnResults: TurnCapture[] = [];
	const totalStart = Date.now();

	for (const turn of scenario.turns) {
		const result = await runTurn(turn, opts);
		turnResults.push(result);
	}

	const totalDurationMs = Date.now() - totalStart;

	return { id: scenario.id, name: scenario.name, description: scenario.description, turns: turnResults, totalDurationMs };
}

async function evaluateArtifactWithJudge(path: string, opts: EvalOptions): Promise<EvaluationArtifact> {
	const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
	if (!apiKey) throw new Error("OPENAI_API_KEY is required");
	const judgeModel = opts.judgeModel ?? opts.model ?? "gpt-5.2";
	const artifact = await readArtifact(path);

	const records: TurnJudgementRecord[] = [];
	let scoreTotal = 0;
	const overallCounts = { strong: 0, acceptable: 0, poor: 0 };

	for (const scenario of artifact.scenarios) {
		for (const turn of scenario.turns) {
			for (const run of turn.runs) {
				const payload = toJudgePayload(turn, run);
				const judgement = await judgeTurnWithLLM(payload, apiKey, judgeModel);
				records.push({
					scenarioId: scenario.id,
					scenarioName: scenario.name,
					turnName: turn.name,
					runIndex: run.runIndex,
					durationMs: run.durationMs,
					judgement,
				});
				scoreTotal += judgement.score;
				overallCounts[judgement.overall] += 1;
			}
		}
	}

	const totalEvaluatedRuns = records.length;
	const averageScore = totalEvaluatedRuns ? scoreTotal / totalEvaluatedRuns : 0;
	artifact.judgement = {
		model: judgeModel,
		createdAt: new Date().toISOString(),
		totalEvaluatedRuns,
		averageScore,
		overallCounts,
		results: records,
	};
	artifact.judgeModel = judgeModel;
	artifact.metrics = computeDeterministicMetrics(artifact);

	await writeArtifact(path, artifact);
	return artifact;
}

// ---------------------------------------------------------------------------
// CLI reporter
// ---------------------------------------------------------------------------

function printResults(artifact: EvaluationArtifact, outputPath: string): void {
	console.log(`\n${"=".repeat(80)}`);
	console.log("INCIDENT AGENT EVALUATION RESULTS");
	console.log(`${"=".repeat(80)}\n`);

	const totalTurns = artifact.scenarios.reduce((count, scenario) => count + scenario.turns.length, 0);
	const totalRuns = artifact.scenarios.reduce((count, scenario) => count + scenario.turns.reduce((turnCount, turn) => turnCount + turn.runs.length, 0), 0);

	console.log(`Artifact file: ${outputPath}`);
	console.log(`Scenarios: ${artifact.scenarios.length}`);
	console.log(`Turns: ${totalTurns}`);
	console.log(`Model runs captured: ${totalRuns}`);

	for (const scenario of artifact.scenarios) {
		console.log(`\n>> ${scenario.name} (${scenario.totalDurationMs}ms)`);
		for (const turn of scenario.turns) {
			console.log(`  - ${turn.name}`);
			console.log(`    Expectations: ${turn.expectations.length}`);
			for (const run of turn.runs) {
				console.log(`    Run ${run.runIndex}: ${run.durationMs}ms, suggestions=${run.suggestions.length}`);
			}
		}
	}

	if (artifact.judgement) {
		console.log("\nJudge summary:");
		console.log(`Judge model: ${artifact.judgement.model}`);
		console.log(`Average score: ${artifact.judgement.averageScore.toFixed(3)}`);
		console.log(
			`Overall counts: strong=${artifact.judgement.overallCounts.strong}, acceptable=${artifact.judgement.overallCounts.acceptable}, poor=${artifact.judgement.overallCounts.poor}`,
		);
	}

	if (artifact.metrics) {
		console.log("\nDeterministic metrics:");
		console.log(`Expectation pass rate: ${(artifact.metrics.expectationPassRate * 100).toFixed(1)}%`);
		console.log(`Positive recall: ${(artifact.metrics.positiveRecall * 100).toFixed(1)}%`);
		console.log(`Precision proxy: ${(artifact.metrics.precisionProxy * 100).toFixed(1)}%`);
		console.log(`Negative violation rate: ${(artifact.metrics.negativeViolationRate * 100).toFixed(1)}%`);
		console.log(`False-resolved rate: ${(artifact.metrics.falseResolvedRate * 100).toFixed(1)}%`);
		console.log(`Duplicate suggestion rate: ${(artifact.metrics.duplicateSuggestionRate * 100).toFixed(1)}%`);
		console.log(`First status-page compliance: ${(artifact.metrics.firstStatusPageComplianceRate * 100).toFixed(1)}%`);
	}

	console.log(`${"=".repeat(80)}\n`);
}

// ---------------------------------------------------------------------------
// Main (CLI entry point)
// ---------------------------------------------------------------------------

async function main() {
	const verbose = process.argv.includes("--verbose") || process.argv.includes("-v");
	const runsArg = process.argv.find((a) => a.startsWith("--runs="));
	const runs = runsArg ? Number.parseInt(runsArg.split("=")[1]!, 10) : 1;
	const modelArg = process.argv.find((a) => a.startsWith("--model="));
	const model = modelArg ? modelArg.split("=")[1]! : undefined;
	const judgeModelArg = process.argv.find((a) => a.startsWith("--judge-model="));
	const judgeModel = judgeModelArg ? judgeModelArg.split("=")[1]! : undefined;
	const scenarioArg = process.argv.find((a) => a.startsWith("--scenario="));
	const scenarioFilter = scenarioArg ? scenarioArg.split("=")[1]! : undefined;
	const promptFileArg = process.argv.find((a) => a.startsWith("--prompt-file="));
	const outArg = process.argv.find((a) => a.startsWith("--out="));
	const reasoningEffortArg = process.argv.find((a) => a.startsWith("--reasoning-effort="));
	const outputPath = resolve(outArg ? outArg.split("=")[1]! : buildDefaultOutputPath());
	const skipJudge = process.argv.includes("--skip-judge");
	const reasoningEffortRaw = reasoningEffortArg ? reasoningEffortArg.split("=")[1]! : "medium";
	if (!["low", "medium", "high"].includes(reasoningEffortRaw)) {
		console.error(`Invalid --reasoning-effort value "${reasoningEffortRaw}". Use low|medium|high.`);
		process.exit(1);
	}
	const reasoningEffort = reasoningEffortRaw as ReasoningEffort;

	const scenarios = scenarioFilter ? SCENARIOS.filter((s) => s.id === scenarioFilter) : SCENARIOS;

	if (scenarios.length === 0) {
		console.error(`No scenario matching "${scenarioFilter}". Available: ${SCENARIOS.map((s) => s.id).join(", ")}`);
		process.exit(1);
	}

	console.log(`Running ${scenarios.length} lifecycle scenario(s) (${scenarios.reduce((n, s) => n + s.turns.length, 0)} turns)${runs > 1 ? ` x${runs} runs` : ""}...`);
	if (model) console.log(`Model: ${model}`);
	if (judgeModel) console.log(`Judge model: ${judgeModel}`);
	if (promptFileArg) console.log(`Prompt file: ${promptFileArg.split("=")[1]}`);
	if (reasoningEffortArg) console.log(`Reasoning effort: ${reasoningEffort}`);
	console.log();

	const modelName = model ?? "gpt-5.2";
	const systemPrompt = promptFileArg ? await readFile(resolve(promptFileArg.split("=")[1]!), "utf8") : SYSTEM_PROMPT;
	const results: ScenarioCapture[] = [];
	for (const scenario of scenarios) {
		console.log(`>> ${scenario.name}`);
		console.log(`   ${scenario.description}\n`);
		const result = await runLifecycleScenario(scenario, { verbose, runs, model: modelName, systemPrompt, reasoningEffort });
		results.push(result);
	}

	const artifact: EvaluationArtifact = {
		version: 3,
		createdAt: new Date().toISOString(),
		model: modelName,
		systemPrompt,
		judgeModel,
		runsPerTurn: runs,
		scenarios: results,
	};
	artifact.metrics = computeDeterministicMetrics(artifact);

	await writeArtifact(outputPath, artifact);
	console.log(`Wrote raw artifact: ${outputPath}`);

	let judgedArtifact = artifact;
	if (!skipJudge) {
		console.log("Running LLM judge over captured artifact...");
		judgedArtifact = await evaluateArtifactWithJudge(outputPath, { model: modelName, judgeModel });
		console.log(`Updated artifact with judgement: ${outputPath}`);
	}

	printResults(judgedArtifact, outputPath);
}

const isDirectRun = process.argv[1]?.endsWith("eval.test.ts") || process.argv[1]?.includes("eval.test.ts");
if (isDirectRun) {
	main().catch((err) => {
		console.error("Fatal error:", err);
		process.exit(2);
	});
}
