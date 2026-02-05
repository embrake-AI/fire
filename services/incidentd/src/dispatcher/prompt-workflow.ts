import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { IS } from "@fire/common";
import { buildSuggestionTools, getValidStatusTransitions } from "../agent/suggestions";
import type { AgentContextResponse, AgentPromptPayload, AgentSuggestionContext } from "../agent/types";
import { addReaction, removeReaction } from "../lib/slack";

const SYSTEM_PROMPT = `You are an incident response agent helping respond to a user prompt.
You may either:
- Use tools to apply changes to the incident or status page.
- Reply to the prompt with a concise text response.

Rules:
- Only use tools when you are directly instructed to do so.
- Keep replies concise.`;

function buildPromptUserMessage(context: AgentSuggestionContext) {
	const eventsDescription = context.events
		.map((event) => {
			const data = JSON.stringify(event.event_data);
			return `[${event.created_at}] ${event.event_type}: ${data}`;
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

type IncidentAgentStub = {
	getAgentContext: () => Promise<AgentContextResponse>;
	updateStatus: (status: Exclude<IS["status"], "open">, message: string, adapter: "slack" | "dashboard" | "fire", eventMetadata?: Record<string, string>) => Promise<unknown>;
	setSeverity: (severity: IS["severity"], adapter: "slack" | "dashboard" | "fire", eventMetadata?: Record<string, string>) => Promise<unknown>;
	updateAffection: (params: {
		message: string;
		status?: "investigating" | "mitigating" | "resolved";
		title?: string;
		services?: { id: string; impact: "partial" | "major" }[];
		createdBy: string;
		adapter: "slack" | "dashboard" | "fire";
		eventMetadata?: Record<string, string>;
	}) => Promise<{ error: string } | undefined>;
	addMessage: (
		message: string,
		userId: string,
		messageId: string,
		adapter: "slack" | "dashboard" | "fire",
		slackUserToken?: string,
		eventMetadata?: Record<string, string>,
	) => Promise<unknown>;
};

export class IncidentPromptWorkflow extends WorkflowEntrypoint<Env, AgentPromptPayload> {
	async run(event: WorkflowEvent<AgentPromptPayload>, step: WorkflowStep) {
		const payload = event.payload;
		const stub = this.env.INCIDENT.get(this.env.INCIDENT.idFromString(payload.incidentId)) as unknown as IncidentAgentStub;
		const contextResponse = (await step.do(`agent-prompt.context:${payload.incidentId}:${payload.ts}`, { retries: { limit: 3, delay: "2 seconds" } }, () =>
			stub.getAgentContext(),
		)) as AgentContextResponse;
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
			validStatusTransitions: getValidStatusTransitions(incident.status),
			prompt: {
				text: payload.prompt,
				userId: payload.userId,
				ts: payload.ts,
				channel: payload.channel,
				threadTs: payload.threadTs,
			},
		};

		const tools = buildSuggestionTools(context);
		const messages: Array<{ role: "system" | "user" | "assistant" | "tool"; content?: string; tool_calls?: unknown; name?: string }> = [
			{ role: "system", content: SYSTEM_PROMPT },
			{ role: "user", content: buildPromptUserMessage(context) },
		];

		try {
			if (payload.adapter === "slack" && metadata.botToken) {
				await step.do(`agent-prompt.add-reaction:${payload.incidentId}:${payload.ts}`, { retries: { limit: 3, delay: "1 second" } }, () =>
					addReaction(metadata.botToken, payload.channel, payload.ts, "fire"),
				);
			}

			const data = (await step.do(`agent-prompt.fetch:${payload.incidentId}:${payload.ts}`, { retries: { limit: 3, delay: "3 seconds" } }, async () => {
				const response = await fetch("https://api.openai.com/v1/chat/completions", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${this.env.OPENAI_API_KEY}`,
					},
					body: JSON.stringify({
						model: "gpt-5.2",
						messages,
						tools,
						tool_choice: "auto",
					}),
				});

				if (!response.ok) {
					const error = await response.text();
					throw new Error(`OpenAI API error: ${response.status} - ${error}`);
				}

				return (await response.json()) as {
					choices: Array<{
						message: {
							content: string | null;
							tool_calls?: Array<{ function: { name: string; arguments: string } }>;
						};
					}>;
				};
			})) as {
				choices: Array<{
					message: {
						content: string | null;
						tool_calls?: Array<{ function: { name: string; arguments: string } }>;
					};
				}>;
			};

			const message = data.choices[0]?.message;
			if (!message) {
				return;
			}

			const toolCall = message.tool_calls?.[0];
			if (toolCall) {
				const args = toolCall.function.arguments ? (JSON.parse(toolCall.function.arguments) as Record<string, unknown>) : {};
				switch (toolCall.function.name) {
					case "update_status": {
						if (typeof args.status === "string" && typeof args.message === "string") {
							await step.do(`agent-prompt.apply-status:${payload.incidentId}:${payload.ts}`, { retries: { limit: 3, delay: "2 seconds" } }, async () => {
								await stub.updateStatus(args.status as Exclude<IS["status"], "open">, args.message as string, "fire", eventMetadata);
								return null;
							});
						}
						break;
					}
					case "update_severity": {
						if (typeof args.severity === "string") {
							await step.do(`agent-prompt.apply-severity:${payload.incidentId}:${payload.ts}`, { retries: { limit: 3, delay: "2 seconds" } }, async () => {
								await stub.setSeverity(args.severity as IS["severity"], "fire", eventMetadata);
								return null;
							});
						}
						break;
					}
					case "add_status_page_update": {
						if (typeof args.message === "string") {
							await step.do(`agent-prompt.apply-affection:${payload.incidentId}:${payload.ts}`, { retries: { limit: 3, delay: "2 seconds" } }, async () => {
								await stub.updateAffection({
									message: args.message as string,
									...(typeof args.affectionStatus === "string" ? { status: args.affectionStatus as "investigating" | "mitigating" | "resolved" } : {}),
									...(typeof args.title === "string" ? { title: args.title as string } : {}),
									...(Array.isArray(args.services) ? { services: args.services as { id: string; impact: "partial" | "major" }[] } : {}),
									createdBy: "fire",
									adapter: "fire",
									eventMetadata,
								});
								return null;
							});
						}
						break;
					}
				}

				return;
			}

			const trimmedResponse = message.content?.trim();
			if (trimmedResponse) {
				await step.do(`agent-prompt.respond:${payload.incidentId}:${payload.ts}`, { retries: { limit: 3, delay: "2 seconds" } }, async () => {
					await stub.addMessage(trimmedResponse, "", `fire-prompt:${payload.ts}`, "fire", undefined, eventMetadata);
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
