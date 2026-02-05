import type { IS } from "@fire/common";
import type { AgentAffectionInfo, AgentEvent, AgentSuggestion, AgentSuggestionContext } from "./types";

const SYSTEM_PROMPT = `You are an incident operations agent. Based on the incident context and recent events, propose a small set of concrete, high-confidence suggestions for a human dispatcher to apply.

Rules:
- Only suggest actions you are confident are correct from the context.
- Do not repeat suggestions. If there is a recent suggestion message, do not suggest the same.
- Only suggest when there is very clear intent from actual, past events. If intent is ambiguous, do not suggest.
- Do not speculate or advise about future or hypothetical actions (no "if/when you do X, then do Y").
- Do not suggest actions for things that have not already happened.
- Keep suggestion messages short (max ~200 characters).
- Suggest at most 3 actions total.
- If no suggestions are appropriate, do not call any tools.

Allowed actions (use tools):
1) update_status: move to mitigating or resolved. Must include a concise message. Updating to resolved terminates (closes) the incident.
2) update_severity: change severity to low/medium/high.
3) add_status_page_update: post a public update. Must include a message. If no status page incident exists yet, you MUST include status=investigating and include a title and services (choose from allowed services).`;

const DEVELOPER_PROMPT = `You may call tools to emit suggestions. Each tool call is treated as a suggested action (not executed). Do not repeat the same tool. IF NO SUGGESTIONS ARE APPROPRIATE, DO NOT CALL ANY TOOLS.`;

const VOLATILE_EVENT_KEYS = new Set(["created_at", "createdAt", "ts", "timestamp", "messageId", "promptTs", "promptThreadTs"]);

type SuggestionMessage = { role: "system" | "user" | "assistant" | "tool"; content?: string; tool_calls?: unknown; name?: string };
type SuggestionTool = { type: "function"; function: { name: string; description: string; parameters: unknown } };
type ResponsesInputMessage = { type: "message"; role: "system" | "developer" | "user" | "assistant"; content: string };
type ResponsesFunctionTool = { type: "function"; name: string; description: string; parameters: unknown };

function normalizeEventData(value: unknown): unknown {
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

function toResponsesTools(tools: SuggestionTool[]): ResponsesFunctionTool[] {
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
	return `${trimmed.slice(0, max - 1)}…`;
}

function buildEventMessages(events: AgentEvent[], processedThroughId: number): Array<{ role: "user" | "assistant"; content: string }> {
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

		const role = event.event_metadata?.agentSuggestionId ? "assistant" : "user";
		const data = JSON.stringify(normalizeEventData(event.event_data));
		const content = `${event.event_type}: ${data}`;
		messages.push({ role, content });
	}

	return messages;
}

export function buildSuggestionTools(context: AgentSuggestionContext): SuggestionTool[] {
	const statusOptions = context.validStatusTransitions.length ? context.validStatusTransitions : ["mitigating", "resolved"];
	const serviceOptions = context.services.map((service) => service.id);

	return [
		{
			type: "function",
			function: {
				name: "update_status",
				description: "Suggest updating incident status with a short message.",
				parameters: {
					type: "object",
					properties: {
						status: { type: "string", enum: statusOptions },
						message: { type: "string" },
					},
					required: ["status", "message"],
					additionalProperties: false,
				},
			},
		},
		{
			type: "function",
			function: {
				name: "update_severity",
				description: "Suggest updating incident severity.",
				parameters: {
					type: "object",
					properties: {
						severity: { type: "string", enum: ["low", "medium", "high"] },
					},
					required: ["severity"],
					additionalProperties: false,
				},
			},
		},
		{
			type: "function",
			function: {
				name: "add_status_page_update",
				description: "Suggest posting a public status page update.",
				parameters: {
					type: "object",
					properties: {
						message: { type: "string" },
						affectionStatus: { type: "string", enum: ["investigating", "mitigating", "resolved"] },
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
					required: ["message"],
					additionalProperties: false,
				},
			},
		},
	];
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
				const affectionStatus = suggestion.affectionStatus;
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
	stepDo: (name: string, callback: () => Promise<unknown>) => Promise<unknown>,
	stepLabel: string,
): Promise<AgentSuggestion[]> {
	const servicesDescription = context.services.length
		? context.services.map((service) => `- ${service.name} (${service.id}): ${service.prompt ?? "(no prompt)"}`).join("\n")
		: "(none)";

	const userMessage = `Allowed services:
${servicesDescription}`;

	const eventMessages = buildEventMessages(context.events, context.processedThroughId ?? 0);

	const suggestions: AgentSuggestion[] = [];
	const tools = buildSuggestionTools(context);
	const messages: SuggestionMessage[] = [
		{ role: "system", content: SYSTEM_PROMPT },
		{ role: "system", content: DEVELOPER_PROMPT },
		{ role: "user", content: userMessage },
		...eventMessages,
		{ role: "user", content: "Return suggestions." },
	];
	const usedToolNames = new Set<string>();
	const incidentId = context.incident.id;
	const promptCacheKey = `is:v1:${incidentId.slice(0, 12)}:${incidentId.slice(-8)}`;

	for (let i = 0; i < 5 && suggestions.length < 3; i += 1) {
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

		const data = (await stepDo(`agent-suggest.fetch:${stepLabel}:${i + 1}`, async () => {
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

			return (await response.json()) as OpenAIResponsesCreateResponse;
		})) as OpenAIResponsesCreateResponse;
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
			break;
		}

		let addedSuggestionThisRound = false;
		for (const toolCall of toolCalls) {
			if (usedToolNames.has(toolCall.function.name)) {
				continue;
			}

			usedToolNames.add(toolCall.function.name);
			const args = toolCall.function.arguments ? (JSON.parse(toolCall.function.arguments) as Record<string, unknown>) : {};
			switch (toolCall.function.name) {
				case "update_status": {
					if (typeof args.status === "string" && typeof args.message === "string") {
						suggestions.push({
							action: "update_status",
							status: args.status as Exclude<IS["status"], "open">,
							message: args.message,
						});
						messages.push({
							role: "assistant",
							content: `[SUGGESTION] update_status status=${args.status} message=${args.message}`,
						});
						addedSuggestionThisRound = true;
					}
					break;
				}
				case "update_severity": {
					if (typeof args.severity === "string") {
						suggestions.push({
							action: "update_severity",
							severity: args.severity as IS["severity"],
						});
						messages.push({
							role: "assistant",
							content: `[SUGGESTION] update_severity severity=${args.severity}`,
						});
						addedSuggestionThisRound = true;
					}
					break;
				}
				case "add_status_page_update": {
					if (typeof args.message === "string") {
						suggestions.push({
							action: "add_status_page_update",
							message: args.message,
							...(typeof args.affectionStatus === "string" ? { affectionStatus: args.affectionStatus as "investigating" | "mitigating" | "resolved" } : {}),
							...(typeof args.title === "string" ? { title: args.title } : {}),
							...(Array.isArray(args.services) ? { services: args.services as { id: string; impact: "partial" | "major" }[] } : {}),
						});
						messages.push({
							role: "assistant",
							content: `[SUGGESTION] add_status_page_update message=${args.message}`,
						});
						addedSuggestionThisRound = true;
					}
					break;
				}
				default:
					break;
			}
		}

		if (!addedSuggestionThisRound) {
			break;
		}
	}

	return suggestions;
}
