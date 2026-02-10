import type { IS } from "@fire/common";
import type { AgentAffectionInfo, AgentAffectionStatus, AgentEvent, AgentSuggestion, AgentSuggestionContext } from "./types";

export const SYSTEM_PROMPT = `You are an incident operations agent. You may suggest actions for a human dispatcher by calling tools. Each tool call is treated as a suggested action - it is NOT executed automatically. Tools are optional: only call a tool when the suggestion would be genuinely useful to the dispatcher. If nothing warrants a suggestion, call no tools.

Rules:
- Only suggest actions you are confident are correct based on concrete evidence in the event log. If the incident is vague, unclear, lacking detail or unconfirmed, do not guess - wait for more information. An incident created event does not mean confirmation.
- Every tool call MUST include an evidence field describing the specific event(s) from the log that justify the suggestion.
- NEVER repeat a prior suggestion, even if new evidence appears. Events labeled AGENT_SUGGESTION show your prior suggestions. If an AGENT_SUGGESTION already exists for the same action target (e.g. update_status to mitigating, or update_severity to high), do NOT suggest that action again.
- Only suggest when there is very clear intent from actual, past events. If intent is ambiguous, do not suggest.
- Do not speculate or advise about future or hypothetical actions (no "if/when you do X, then do Y").
- Do not suggest actions for things that have not already happened or been confirmed.
- For status page suggestions:
	1. Only suggest them for clearly confirmed incidents that affect external users in a meaningful way.
	2. HARD GATE: NEVER suggest add_status_page_update when the only evidence is INCIDENT_CREATED and/or ambiguous chat (for example: "not sure", "looks right", "can you check your PC", "maybe"). Those are unconfirmed signals.
	3. Require at least one corroborating post-create signal before add_status_page_update: e.g. measured errors/latency, a second independent report, explicit engineer confirmation of impact, or a concrete mitigation/progress update.
		4. You MUST follow the provided status-page context: if hasAffection=false, the first public update MUST use affectionStatus=investigating (never mitigating/resolved) and include title + services.
		5. If hasAffection=true and there is meaningful new external-user progress/impact information, you SHOULD suggest add_status_page_update in this turn without a status field (even if incident status does not change). Do NOT repeat status, omit it to post an update.
- "Resolved" means the issue is fully over and the incident will be closed. Only suggest resolved when a human explicitly confirms the incident is OVER - the fix is verified AND the problem is completely gone (e.g. "confirmed working", "error rate back to zero", "verified fix", "all clear"). Do NOT suggest resolved when: a fix/restart/purge was just initiated or is in progress, errors have decreased but are not zero, retries are still failing, some users/regions are still affected, or someone is still monitoring/investigating. When in doubt, do NOT suggest resolved - wait for the next turn.
- Resolved requires TWO conditions met simultaneously: (1) a remediation action was completed, AND (2) a human confirmed the problem is gone. A restart being initiated, errors dropping to non-zero, or retries still failing means condition (2) is NOT met.
- Keep suggestion messages short (max ~200 characters).
- Suggest at most 3 actions total.

Allowed actions (use tools):
1) update_status: move to mitigating or resolved. Must include a concise message. Updating to resolved terminates (closes) the incident.
2) update_severity: change severity to low/medium/high.
3) add_status_page_update: post a public update. Must include a message. If no status page incident exists yet, you MUST include status=investigating and include a title and services (choose from allowed services).`;

export const VOLATILE_EVENT_KEYS = new Set(["created_at", "createdAt", "ts", "timestamp", "messageId", "promptTs", "promptThreadTs"]);
const AFFECTION_STATUSES: AgentAffectionStatus[] = ["investigating", "mitigating", "resolved"];

type SuggestionMessage = { role: "system" | "user" | "assistant" | "tool"; content?: string; tool_calls?: unknown; name?: string };
export type SuggestionTool = { type: "function"; function: { name: string; description: string; parameters: unknown } };
type ResponsesInputMessage = { type: "message"; role: "system" | "developer" | "user" | "assistant"; content: string };
export type ResponsesFunctionTool = { type: "function"; name: string; description: string; parameters: unknown };

export function normalizeEventData(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => normalizeEventData(item));
	}

	if (!value || typeof value !== "object") {
		return value;
	}

	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([key]) => !VOLATILE_EVENT_KEYS.has(key))
		.sort(([a], [b]) => a.localeCompare(b));

	return Object.fromEntries(entries.map(([key, item]) => [key, normalizeEventData(item)]));
}

function toResponsesInputMessages(messages: SuggestionMessage[]): ResponsesInputMessage[] {
	const input: ResponsesInputMessage[] = [];
	for (const message of messages) {
		if (!message.content) {
			continue;
		}
		if (message.role === "tool") {
			continue;
		}
		input.push({
			type: "message",
			role: message.role,
			content: message.content,
		});
	}
	return input;
}

export function toResponsesTools(tools: SuggestionTool[]): ResponsesFunctionTool[] {
	const mapped: ResponsesFunctionTool[] = [];
	for (const tool of tools) {
		if (!tool.function.name) {
			continue;
		}
		mapped.push({
			type: "function",
			name: tool.function.name,
			description: tool.function.description,
			parameters: tool.function.parameters,
		});
	}
	return mapped;
}

type OpenAIResponseFunctionCallItem = {
	type?: string;
	name?: string;
	arguments?: string;
};

type OpenAIResponsesCreateResponse = {
	id?: string;
	model?: string;
	usage?: {
		input_tokens?: number;
		output_tokens?: number;
		total_tokens?: number;
		input_tokens_details?: { cached_tokens?: number };
	};
	output?: OpenAIResponseFunctionCallItem[];
};

function truncateMessage(value: string, max = 240) {
	const trimmed = value.trim();
	if (trimmed.length <= max) return trimmed;
	return `${trimmed.slice(0, max - 1)}...`;
}

export function formatSuggestionEvent(event: AgentEvent): string {
	const data = event.event_data as Record<string, unknown>;
	if (data.suggestion && typeof data.suggestion === "object") {
		const suggestion = data.suggestion as Record<string, unknown>;
		return `AGENT_SUGGESTION: ${JSON.stringify(suggestion)}`;
	}
	const message = typeof data.message === "string" ? data.message : "";
	return `AGENT_SUGGESTION: ${message}`;
}

export function buildEventMessages(events: AgentEvent[], processedThroughId: number): Array<{ role: "user" | "assistant"; content: string }> {
	if (!events.length) {
		return [{ role: "user", content: "Recent events:\n(none)" }];
	}

	const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
	let boundaryInserted = false;

	for (const event of events) {
		if (!boundaryInserted && processedThroughId > 0 && event.id > processedThroughId) {
			messages.push({ role: "assistant", content: "[TURN BOUNDARY] Events above already processed. New updates start below." });
			boundaryInserted = true;
		}

		const isSuggestion = event.event_type === "MESSAGE_ADDED" && event.event_metadata?.kind === "suggestion" && !!event.event_metadata?.agentSuggestionId;
		const role = isSuggestion ? "assistant" : "user";
		const content = isSuggestion ? formatSuggestionEvent(event) : `${event.event_type}: ${JSON.stringify(normalizeEventData(event.event_data))}`;
		messages.push({ role, content });
	}

	return messages;
}

export function buildSuggestionTools(context: AgentSuggestionContext): SuggestionTool[] {
	const serviceOptions = context.services.map((service) => service.id);

	return [
		{
			type: "function",
			function: {
				name: "update_status",
				description: `Suggest updating the incident status. Only call when the event log contains clear, confirmed evidence.
- "mitigating": a mitigation action has been taken (e.g. fix deployed, workaround applied, rollback done, service restarted). It does NOT require verification that the fix is working - only that a concrete action has been taken to address the issue. Do NOT suggest if no action has been taken yet (investigating alone is not mitigating).
- "resolved": ONLY when a human explicitly confirms the incident is OVER - the fix is verified AND the problem is completely gone (e.g. "confirmed working", "error rate back to zero", "all clear"). The confirmation must be a statement of verified fact, not a hopeful action.
  NEVER suggest resolved when ANY of these are true: (a) a fix/restart/purge was just initiated or is in progress, (b) error rate has dropped but is not zero, (c) retries are still failing, (d) some users or regions are still affected, (e) someone says they are monitoring or investigating, (f) no human has explicitly confirmed the problem is gone. When in doubt, do NOT suggest resolved - wait for the next turn.`,
				parameters: {
					type: "object",
					properties: {
						evidence: { type: "string", description: "The specific event(s) from the log that justify this suggestion." },
						status: { type: "string", enum: ["mitigating", "resolved"] },
						message: { type: "string" },
					},
					required: ["evidence", "status", "message"],
					additionalProperties: false,
				},
			},
		},
		{
			type: "function",
			function: {
				name: "update_severity",
				description: `Suggest updating the incident severity. Only call when the event log shows clear evidence of changed impact scope.
- "high": confirmed multi-customer or revenue impact, complete service outage, or data loss.
- "medium": partial degradation affecting some users, elevated error rates.
- "low": minimal impact, cosmetic issues, or internal-only.`,
				parameters: {
					type: "object",
					properties: {
						evidence: { type: "string", description: "The specific event(s) from the log that justify this suggestion." },
						severity: { type: "string", enum: ["low", "medium", "high"] },
					},
					required: ["evidence", "severity"],
					additionalProperties: false,
				},
			},
		},
		{
			type: "function",
			function: {
				name: "add_status_page_update",
				description: `Suggest posting a public status page update. Only call when the incident should be notified to external users.
- Use the status-page context provided in the prompt:
  - If hasAffection=false, this is the FIRST public update. You MUST set affectionStatus=investigating and include title + services. Do NOT set mitigating/resolved.
  - If hasAffection=true and there is meaningful external progress/new impact information, you SHOULD call this tool for a follow-up update even when incident status is unchanged.
- Subsequent updates: share updates regularly to keep external users informed - post when there is meaningful progress, status changes, scope changes, or new information about impact/timeline. You do not need to wait for a status change to post an update.
- Do NOT call this tool for internal-only issues (e.g. internal tooling, demo/staging environments, internal dashboards, background jobs that do not affect end users). If the incident has no external user impact, simply do not call this tool.`,
				parameters: {
					type: "object",
					properties: {
						evidence: { type: "string", description: "The specific event(s) from the log that justify this suggestion." },
						message: { type: "string" },
						affectionStatus: { type: "string", enum: ["investigating", "mitigating", "resolved", "update"] },
						title: { type: "string" },
						services: {
							type: "array",
							items: {
								type: "object",
								properties: {
									id: { type: "string", enum: serviceOptions.length ? serviceOptions : [""] },
									impact: { type: "string", enum: ["partial", "major"] },
								},
								required: ["id", "impact"],
								additionalProperties: false,
							},
						},
					},
					required: ["evidence", "message"],
					additionalProperties: false,
				},
			},
		},
	];
}

export function buildContextUserMessage(context: AgentSuggestionContext): string {
	const servicesDescription = context.services.length
		? context.services.map((service) => `- ${service.name} (${service.id}): ${service.prompt ?? "(no prompt)"}`).join("\n")
		: "(none)";
	return `Allowed services:\n${servicesDescription}`;
}

function parseAffectionStatus(value: unknown): AgentAffectionStatus | undefined {
	if (typeof value !== "string" || value === "update") {
		return undefined;
	}
	return AFFECTION_STATUSES.includes(value as AgentAffectionStatus) ? (value as AgentAffectionStatus) : undefined;
}

function formatRelativeTime(value?: string): string {
	if (!value) {
		return "none";
	}

	const direct = Date.parse(value);
	const parsed = Number.isNaN(direct) && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? Date.parse(`${value.replace(" ", "T")}Z`) : direct;

	if (Number.isNaN(parsed)) {
		return "unknown";
	}

	const diffMs = Date.now() - parsed;
	if (diffMs <= 0) {
		return "just now";
	}

	const diffMinutes = Math.floor(diffMs / 60_000);
	if (diffMinutes < 1) {
		return "just now";
	}
	if (diffMinutes < 60) {
		return `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
	}

	const diffHours = Math.floor(diffMinutes / 60);
	if (diffHours < 24) {
		return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
	}

	const diffDays = Math.floor(diffHours / 24);
	return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
}

export function buildStatusPageContextMessage(context: AgentSuggestionContext): string {
	const created = context.affection.hasAffection ? "yes" : "no";
	const lastStatus = context.affection.lastStatus ?? "none";
	const lastUpdatedAt = formatRelativeTime(context.affection.lastUpdateAt);

	return `Status page state:
- created: ${created}
- lastStatus: ${lastStatus}
- lastUpdatedAt: ${lastUpdatedAt}`;
}

export function buildIncidentStateMessage(context: AgentSuggestionContext): string {
	const validTransitions = context.validStatusTransitions.length ? context.validStatusTransitions.join(", ") : "none";
	return `Incident state:\n- status: ${context.incident.status} (valid transitions: ${validTransitions})\n- severity: ${context.incident.severity}`;
}

export function getValidStatusTransitions(currentStatus: IS["status"]): Array<Exclude<IS["status"], "open">> {
	switch (currentStatus) {
		case "open":
			return ["mitigating", "resolved"];
		case "mitigating":
			return ["resolved"];
		case "resolved":
			return [];
	}
}

export function deriveAffectionInfo(events: AgentEvent[]): AgentAffectionInfo {
	let hasAffection = false;
	let lastStatus: AgentAffectionInfo["lastStatus"];
	let lastUpdateAt: string | undefined;

	for (const event of events) {
		if (event.event_type !== "AFFECTION_UPDATE") {
			continue;
		}
		hasAffection = true;
		const data = event.event_data as { status?: AgentAffectionInfo["lastStatus"] };
		if (data?.status) {
			lastStatus = data.status;
		}
		lastUpdateAt = event.created_at;
	}

	return { hasAffection, lastStatus, lastUpdateAt };
}

export function normalizeSuggestions(suggestions: AgentSuggestion[], context: AgentSuggestionContext): AgentSuggestion[] {
	const normalized: AgentSuggestion[] = [];
	for (const suggestion of suggestions) {
		switch (suggestion.action) {
			case "update_status": {
				const message = suggestion.message?.trim();
				if (!suggestion.status || !message) {
					continue;
				}
				if (context.validStatusTransitions.length && !context.validStatusTransitions.includes(suggestion.status)) {
					continue;
				}
				normalized.push({
					action: "update_status",
					status: suggestion.status,
					message: truncateMessage(message),
				});
				break;
			}
			case "update_severity": {
				if (!suggestion.severity) {
					continue;
				}
				if (suggestion.severity === context.incident.severity) {
					continue;
				}
				normalized.push({
					action: "update_severity",
					severity: suggestion.severity,
				});
				break;
			}
			case "add_status_page_update": {
				const message = suggestion.message?.trim();
				if (!message) {
					continue;
				}
				const services = Array.isArray(suggestion.services) ? suggestion.services : undefined;
				const affectionStatus = parseAffectionStatus(suggestion.affectionStatus);
				const title = suggestion.title?.trim();

				if (!context.affection.hasAffection) {
					if (!services?.length || !title || affectionStatus !== "investigating") {
						continue;
					}
				}

				normalized.push({
					action: "add_status_page_update",
					message: truncateMessage(message),
					...(affectionStatus ? { affectionStatus } : {}),
					...(title ? { title } : {}),
					...(services?.length ? { services } : {}),
				});
				break;
			}
		}
	}

	return normalized;
}

export async function generateIncidentSuggestions(
	context: AgentSuggestionContext,
	openaiApiKey: string,
	stepDo: <T extends Rpc.Serializable<T>>(name: string, callback: () => Promise<T>) => Promise<T>,
	stepLabel: string,
): Promise<AgentSuggestion[]> {
	const userMessage = buildContextUserMessage(context);
	const statusPageContextMessage = buildStatusPageContextMessage(context);
	const incidentStateMessage = buildIncidentStateMessage(context);

	const eventMessages = buildEventMessages(context.events, context.processedThroughId ?? 0);

	const suggestions: AgentSuggestion[] = [];
	const tools = buildSuggestionTools(context);
	const messages: SuggestionMessage[] = [
		{ role: "system", content: SYSTEM_PROMPT },
		{ role: "user", content: userMessage },
		...eventMessages,
		{ role: "user", content: statusPageContextMessage },
		{ role: "user", content: incidentStateMessage },
		{ role: "user", content: "Return suggestions." },
	];

	const usedToolNames = new Set<string>();
	const incidentId = context.incident.id;
	const promptCacheKey = `is:v1:${incidentId.slice(0, 12)}:${incidentId.slice(-8)}`;

	const input = toResponsesInputMessages(messages);
	const responseTools = toResponsesTools(tools);
	const requestBody = {
		model: "gpt-5.2",
		input,
		tools: responseTools,
		tool_choice: "auto" as const,
		prompt_cache_key: promptCacheKey,
	};
	const serializedRequestBody = JSON.stringify(requestBody);

	const data = await stepDo(`agent-suggest.fetch:${stepLabel}`, async () => {
		console.log(serializedRequestBody);
		const response = await fetch("https://api.openai.com/v1/responses", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${openaiApiKey}`,
			},
			body: serializedRequestBody,
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`OpenAI API error: ${response.status} - ${error}`);
		}

		const responseJson = (await response.json()) as OpenAIResponsesCreateResponse;
		console.log(responseJson);
		return responseJson;
	});
	const toolCalls = (data.output ?? [])
		.filter(
			(item): item is Required<Pick<OpenAIResponseFunctionCallItem, "name">> & OpenAIResponseFunctionCallItem => item.type === "function_call" && typeof item.name === "string",
		)
		.map((item) => ({
			function: {
				name: item.name,
				arguments: typeof item.arguments === "string" ? item.arguments : "{}",
			},
		}));
	if (!toolCalls.length) {
		return suggestions;
	}

	for (const toolCall of toolCalls) {
		if (suggestions.length >= 3) {
			break;
		}
		if (usedToolNames.has(toolCall.function.name)) {
			continue;
		}

		usedToolNames.add(toolCall.function.name);
		const args = toolCall.function.arguments ? (JSON.parse(toolCall.function.arguments) as Record<string, unknown>) : {};
		switch (toolCall.function.name) {
			case "update_status": {
				if (typeof args.evidence === "string" && args.evidence.trim() && typeof args.status === "string" && typeof args.message === "string") {
					suggestions.push({
						action: "update_status",
						status: args.status as Exclude<IS["status"], "open">,
						message: args.message,
					});
					messages.push({
						role: "assistant",
						content: `[SUGGESTION] update_status status=${args.status} message=${args.message}`,
					});
				}
				break;
			}
			case "update_severity": {
				if (typeof args.evidence === "string" && args.evidence.trim() && typeof args.severity === "string") {
					suggestions.push({
						action: "update_severity",
						severity: args.severity as IS["severity"],
					});
					messages.push({
						role: "assistant",
						content: `[SUGGESTION] update_severity severity=${args.severity}`,
					});
				}
				break;
			}
			case "add_status_page_update": {
				if (typeof args.evidence === "string" && args.evidence.trim() && typeof args.message === "string") {
					const affectionStatus = parseAffectionStatus(args.affectionStatus);
					suggestions.push({
						action: "add_status_page_update",
						message: args.message,
						...(affectionStatus ? { affectionStatus } : {}),
						...(typeof args.title === "string" ? { title: args.title } : {}),
						...(Array.isArray(args.services) ? { services: args.services as { id: string; impact: "partial" | "major" }[] } : {}),
					});
					messages.push({
						role: "assistant",
						content: `[SUGGESTION] add_status_page_update message=${args.message}`,
					});
				}
				break;
			}
			default:
				break;
		}
	}

	return suggestions;
}
