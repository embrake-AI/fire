import type { IS } from "@fire/common";
import { logOpenAIUsage } from "../lib/openai-usage";
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

function fnv1aHash(value: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < value.length; i += 1) {
		hash ^= value.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

function commonPrefixLength(a: string, b: string): number {
	const minLength = Math.min(a.length, b.length);
	for (let i = 0; i < minLength; i += 1) {
		if (a[i] !== b[i]) {
			return i;
		}
	}
	return minLength;
}

function logPromptPrefixDiagnostics(params: {
	context: string;
	serializedRequestBody: string;
	previousSerializedRequestBody?: string;
	messages: SuggestionMessage[];
	tools: SuggestionTool[];
}) {
	const { context, serializedRequestBody, previousSerializedRequestBody, messages, tools } = params;
	const prefixProbeLength = 8_192;
	const prefixProbe = serializedRequestBody.slice(0, prefixProbeLength);
	const previousPrefixProbe = previousSerializedRequestBody?.slice(0, prefixProbeLength);
	const prefixChanged = previousPrefixProbe ? previousPrefixProbe !== prefixProbe : null;
	const matchingPrefixChars = previousPrefixProbe ? commonPrefixLength(previousPrefixProbe, prefixProbe) : null;

	console.log("[openai.prompt-prefix]", {
		context,
		requestHash: fnv1aHash(serializedRequestBody),
		prefixHash: fnv1aHash(prefixProbe),
		prefixProbeLength,
		prefixChanged,
		matchingPrefixChars,
		messageCount: messages.length,
		toolNames: tools.map((tool) => tool.function.name),
	});
}

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
	let tools = buildSuggestionTools(context);
	const messages: SuggestionMessage[] = [
		{ role: "system", content: SYSTEM_PROMPT },
		{ role: "system", content: DEVELOPER_PROMPT },
		{ role: "user", content: userMessage },
		...eventMessages,
		{ role: "user", content: "Return suggestions." },
	];
	const usedToolNames = new Set<string>();
	let previousSerializedRequestBody: string | undefined;

	for (let i = 0; i < 5 && suggestions.length < 3; i += 1) {
		const requestBody = {
			model: "gpt-5.2",
			messages,
			tools,
			tool_choice: "auto" as const,
		};
		const serializedRequestBody = JSON.stringify(requestBody);
		logPromptPrefixDiagnostics({
			context: `generateIncidentSuggestions:${stepLabel}:${i + 1}`,
			serializedRequestBody,
			previousSerializedRequestBody,
			messages,
			tools,
		});
		previousSerializedRequestBody = serializedRequestBody;

		const data = (await stepDo(`agent-suggest.fetch:${stepLabel}:${i + 1}`, async () => {
			const response = await fetch("https://api.openai.com/v1/chat/completions", {
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

			return (await response.json()) as {
				id?: string;
				model?: string;
				usage?: {
					prompt_tokens?: number;
					completion_tokens?: number;
					total_tokens?: number;
					prompt_tokens_details?: { cached_tokens?: number };
				};
				choices: Array<{
					message: {
						content: string | null;
						tool_calls?: Array<{ function: { name: string; arguments: string } }>;
					};
				}>;
			};
		})) as {
			id?: string;
			model?: string;
			usage?: {
				prompt_tokens?: number;
				completion_tokens?: number;
				total_tokens?: number;
				prompt_tokens_details?: { cached_tokens?: number };
			};
			choices: Array<{
				message: {
					content: string | null;
					tool_calls?: Array<{ function: { name: string; arguments: string } }>;
				};
			}>;
		};
		logOpenAIUsage(`generateIncidentSuggestions:${stepLabel}:${i + 1}`, data);

		const message = data.choices[0]?.message;
		if (!message) {
			break;
		}

		const toolCalls = message.tool_calls ?? [];
		if (!toolCalls.length) {
			break;
		}

		for (const toolCall of toolCalls) {
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
					}
					break;
				}
				default:
					break;
			}
		}

		if (usedToolNames.size) {
			tools = tools.filter((tool) => tool.function.name && !usedToolNames.has(tool.function.name));
			if (!tools.length) {
				break;
			}
		}
	}

	return suggestions;
}
