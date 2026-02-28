import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { IS } from "@fire/common";
import OpenAI from "openai";
import { formatAgentEventForPrompt } from "../agent/event-format";
import { isResponsesFunctionToolCall, parseJsonObject } from "../agent/openai";
import { getSimilarIncidentsProvider } from "../agent/providers/registry";
import type { AgentContextResponse, AgentPromptPayload, AgentSuggestionContext } from "../agent/types";
import { addReaction, removeReaction } from "../lib/slack";

const SYSTEM_PROMPT = `You are an incident operations assistant.
You must choose one mode:
1) If the user prompt includes an explicit instruction to change incident state or status page, call the matching tool and execute it.
2) If the user asks to query or prompt a context agent (e.g. similar incidents), forward the prompt by calling the agent's tool.
3) If there is no explicit instruction, reply with concise plain text.

Rules:
- Follow explicit user instructions immediately.
- Keep text replies concise.`;

function getPromptWorkflowValidStatusTransitions(currentStatus: IS["status"]): Array<Exclude<IS["status"], "open">> {
	switch (currentStatus) {
		case "open":
			return ["mitigating", "resolved", "declined"];
		case "mitigating":
			return ["resolved", "declined"];
		case "resolved":
		case "declined":
			return [];
	}
}

function buildPromptTools(context: AgentSuggestionContext): OpenAI.Responses.FunctionTool[] {
	const serviceOptions = context.services.map((service) => service.id);
	return [
		{
			type: "function",
			name: "update_status",
			description: "Update incident status.",
			strict: true,
			parameters: {
				type: "object",
				properties: {
					status: { type: "string", enum: ["mitigating", "resolved", "declined"] },
					message: { type: "string", description: "Message explaining status change. Keep concise." },
				},
				required: ["status", "message"],
				additionalProperties: false,
			},
		},
		{
			type: "function",
			name: "update_severity",
			description: "Update incident severity.",
			strict: true,
			parameters: {
				type: "object",
				properties: {
					severity: { type: "string", enum: ["low", "medium", "high"] },
				},
				required: ["severity"],
				additionalProperties: false,
			},
		},
		{
			type: "function",
			name: "prompt_similar_incidents",
			description: "Forward a question to the similar-incidents agent. Use when the user asks about past incidents or patterns.",
			strict: true,
			parameters: {
				type: "object",
				properties: {
					prompt: { type: "string", description: "The question to forward to the similar-incidents agent." },
				},
				required: ["prompt"],
				additionalProperties: false,
			},
		},
		{
			type: "function",
			name: "add_status_page_update",
			description: "Post a status page update.",
			strict: true,
			parameters: {
				type: "object",
				properties: {
					message: { type: "string" },
					affectionStatus: { type: ["string", "null"], enum: ["investigating", "mitigating", "resolved", null] },
					title: { type: ["string", "null"] },
					services: {
						type: ["array", "null"],
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
				required: ["message", "affectionStatus", "title", "services"],
				additionalProperties: false,
			},
		},
	];
}

function parsePromptStatus(value: unknown): "mitigating" | "resolved" | "declined" | undefined {
	if (value === "mitigating" || value === "resolved" || value === "declined") {
		return value;
	}
	return undefined;
}

function parsePromptSeverity(value: unknown): "low" | "medium" | "high" | undefined {
	if (value === "low" || value === "medium" || value === "high") {
		return value;
	}
	return undefined;
}

function parsePromptAffectionStatus(value: unknown): "investigating" | "mitigating" | "resolved" | undefined {
	if (value === "investigating" || value === "mitigating" || value === "resolved") {
		return value;
	}
	return undefined;
}

function parsePromptServices(value: unknown): { id: string; impact: "partial" | "major" }[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}

	const services = value
		.map((service) => {
			if (!service || typeof service !== "object") {
				return null;
			}
			const typed = service as { id?: unknown; impact?: unknown };
			if (typeof typed.id !== "string") {
				return null;
			}
			if (typed.impact !== "partial" && typed.impact !== "major") {
				return null;
			}
			return { id: typed.id, impact: typed.impact };
		})
		.filter((service): service is { id: string; impact: "partial" | "major" } => !!service);

	return services.length ? services : undefined;
}

function buildPromptUserMessage(context: AgentSuggestionContext) {
	const eventsDescription = context.events
		.map((event) => {
			return `[${event.created_at}] ${formatAgentEventForPrompt(event)}`;
		})
		.join("\n");

	const servicesDescription = context.services.length
		? context.services.map((service) => `- ${service.name} (${service.id}): ${service.prompt ?? "(no prompt)"}`).join("\n")
		: "(none)";

	const affectionDescription = context.affection.hasAffection
		? `Status page incident exists. Last status: ${context.affection.lastStatus ?? "unknown"}. Last update: ${context.affection.lastUpdateAt ?? "unknown"}.`
		: "No status page incident exists yet.";

	const promptSection = context.prompt
		? `\nUser prompt:
${context.prompt.text}
`
		: "";

	return `Incident:
Title: ${context.incident.title}
Description: ${context.incident.description}
Status: ${context.incident.status}
Severity: ${context.incident.severity}
Assignee: ${context.incident.assignee || "unassigned"}
Source: ${context.incident.source}
CreatedAt: ${context.incident.createdAt}
Valid status transitions: ${context.validStatusTransitions.length ? context.validStatusTransitions.join(", ") : "none"}

Status page context:
${affectionDescription}

Allowed services:
${servicesDescription}
${promptSection}
Recent events:
${eventsDescription}`;
}

export class IncidentPromptWorkflow extends WorkflowEntrypoint<Env, AgentPromptPayload> {
	async run(event: WorkflowEvent<AgentPromptPayload>, step: WorkflowStep) {
		const payload = event.payload;
		const incidentId = this.env.INCIDENT.idFromString(payload.incidentId);
		const contextResponse = await step.do<AgentContextResponse>(
			`agent-prompt.context:${payload.incidentId}:${payload.ts}`,
			{ retries: { limit: 3, delay: "2 seconds" } },
			async () => {
				const incidentStub = this.env.INCIDENT.get(incidentId);
				const response = await incidentStub.getAgentContext();
				if (!response || "error" in response) {
					const errorText = response && "error" in response ? await response.error : "FAILED_TO_LOAD_AGENT_CONTEXT";
					return { error: String(errorText) };
				}

				const [incident, metadata, services, affection, events] = await Promise.all([response.incident, response.metadata, response.services, response.affection, response.events]);

				return { incident, metadata, services, affection, events };
			},
		);
		if ("error" in contextResponse || !contextResponse.incident) {
			return;
		}
		const { metadata } = contextResponse;

		const eventMetadata = {
			promptTs: payload.ts,
			promptChannel: payload.channel,
			promptUserId: payload.userId,
			...(payload.threadTs ? { promptThreadTs: payload.threadTs } : {}),
		};

		const { incident, services, affection, events } = contextResponse;
		const context: AgentSuggestionContext = {
			incident,
			services,
			affection,
			events,
			validStatusTransitions: getPromptWorkflowValidStatusTransitions(incident.status),
			prompt: {
				text: payload.prompt,
				userId: payload.userId,
				ts: payload.ts,
				channel: payload.channel,
				threadTs: payload.threadTs,
			},
		};

		const tools = buildPromptTools(context);
		const input: OpenAI.Responses.EasyInputMessage[] = [
			{ role: "system", content: SYSTEM_PROMPT },
			{ role: "user", content: buildPromptUserMessage(context) },
		];

		try {
			if (payload.adapter === "slack" && metadata.botToken) {
				await step.do(`agent-prompt.add-reaction:${payload.incidentId}:${payload.ts}`, { retries: { limit: 3, delay: "1 second" } }, () =>
					addReaction(metadata.botToken, payload.channel, payload.ts, "fire"),
				);
			}

			const data = await step.do<{ outputText: string; toolCall: OpenAI.Responses.ResponseFunctionToolCall | null }>(
				`agent-prompt.fetch:${payload.incidentId}:${payload.ts}`,
				{ retries: { limit: 3, delay: "3 seconds" } },
				async () => {
					const client = new OpenAI({ apiKey: this.env.OPENAI_API_KEY });
					const response = await client.responses.create({
						model: "gpt-5.2",
						input,
						tools,
						tool_choice: "auto",
						text: { verbosity: "low" },
					});
					const toolCall = (response.output ?? []).find(isResponsesFunctionToolCall) ?? null;
					return {
						outputText: response.output_text,
						toolCall,
					};
				},
			);
			const toolCall = data.toolCall;
			if (toolCall) {
				const functionName = toolCall.name;
				const args = parseJsonObject(toolCall.arguments);
				let handledToolCall = false;
				switch (functionName) {
					case "update_status": {
						const status = parsePromptStatus(args.status);
						const messageText = typeof args.message === "string" ? args.message.trim() : "";
						if (status && messageText) {
							await step.do(`agent-prompt.apply-status:${payload.incidentId}:${payload.ts}`, { retries: { limit: 3, delay: "2 seconds" } }, async () => {
								const incidentStub = this.env.INCIDENT.get(incidentId);
								await incidentStub.updateStatus(status, messageText, "fire", eventMetadata);
							});
							handledToolCall = true;
						}
						break;
					}
					case "update_severity": {
						const severity = parsePromptSeverity(args.severity);
						if (severity) {
							await step.do(`agent-prompt.apply-severity:${payload.incidentId}:${payload.ts}`, { retries: { limit: 3, delay: "2 seconds" } }, async () => {
								const incidentStub = this.env.INCIDENT.get(incidentId);
								await incidentStub.setSeverity(severity, "fire", eventMetadata);
							});
							handledToolCall = true;
						}
						break;
					}
					case "prompt_similar_incidents": {
						const promptText = typeof args.prompt === "string" ? args.prompt.trim() : "";
						if (promptText) {
							const result = await step.do<{ answer: string }>(
								`agent-prompt.similar:${payload.incidentId}:${payload.ts}`,
								{ retries: { limit: 3, delay: "2 seconds" } },
								async () => {
									const provider = getSimilarIncidentsProvider(this.env, payload.incidentId);
									const response = await provider.addPrompt({ question: promptText, requestedAt: new Date().toISOString() });
									return { answer: response?.answer ?? "" };
								},
							);
							const answer = result.answer.trim();
							if (answer) {
								await step.do(`agent-prompt.similar-respond:${payload.incidentId}:${payload.ts}`, { retries: { limit: 3, delay: "2 seconds" } }, async () => {
									const incidentStub = this.env.INCIDENT.get(incidentId);
									await incidentStub.addMessage(answer, "", `fire-prompt:${payload.ts}`, "fire", undefined, eventMetadata);
									return null;
								});
								handledToolCall = true;
							}
						}
						break;
					}
					case "add_status_page_update": {
						const messageText = typeof args.message === "string" ? args.message.trim() : "";
						if (messageText) {
							const affectionStatus = parsePromptAffectionStatus(args.affectionStatus);
							const title = typeof args.title === "string" ? args.title.trim() : "";
							const services = parsePromptServices(args.services);
							await step.do(`agent-prompt.apply-affection:${payload.incidentId}:${payload.ts}`, { retries: { limit: 3, delay: "2 seconds" } }, async () => {
								const incidentStub = this.env.INCIDENT.get(incidentId);
								await incidentStub.updateAffection({
									message: messageText,
									...(affectionStatus ? { status: affectionStatus } : {}),
									...(title ? { title } : {}),
									...(services ? { services } : {}),
									createdBy: "fire",
									adapter: "fire",
									eventMetadata,
								});
							});
							handledToolCall = true;
						}
						break;
					}
				}

				if (handledToolCall) {
					return;
				}
			}

			const trimmedResponse = data.outputText.trim();
			if (trimmedResponse) {
				await step.do(`agent-prompt.respond:${payload.incidentId}:${payload.ts}`, { retries: { limit: 3, delay: "2 seconds" } }, async () => {
					const incidentStub = this.env.INCIDENT.get(incidentId);
					await incidentStub.addMessage(trimmedResponse, "", `fire-prompt:${payload.ts}`, "fire", undefined, eventMetadata);
					return null;
				});
			}
		} finally {
			if (payload.adapter === "slack" && metadata.botToken) {
				await step.do(`agent-prompt.remove-reaction:${payload.incidentId}:${payload.ts}`, { retries: { limit: 3, delay: "1 second" } }, () =>
					removeReaction(metadata.botToken, payload.channel, payload.ts, "fire"),
				);
			}
		}
	}
}
