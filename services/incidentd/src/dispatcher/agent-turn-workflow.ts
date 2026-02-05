import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { buildAgentSuggestionBlocks, postAgentSuggestions } from "../agent/slack";
import { generateIncidentSuggestions, getValidStatusTransitions, normalizeSuggestions } from "../agent/suggestions";
import type { AgentSuggestionContext, AgentTurnPayload } from "../agent/types";

export class IncidentAgentTurnWorkflow extends WorkflowEntrypoint<Env, AgentTurnPayload> {
	async run(event: WorkflowEvent<AgentTurnPayload>, step: WorkflowStep) {
		const payload = event.payload;
		const { incident, metadata, services, affection, events, turnId } = payload;

		const context: AgentSuggestionContext = {
			incident,
			services,
			affection,
			events,
			processedThroughId: payload.fromEventId,
			validStatusTransitions: getValidStatusTransitions(incident.status),
		};

		const stepDo = (name: string, callback: () => Promise<unknown>) => step.do(name, { retries: { limit: 3, delay: "5 seconds" } }, callback as Parameters<WorkflowStep["do"]>[2]);

		const suggestions = await generateIncidentSuggestions(context, this.env.OPENAI_API_KEY, stepDo, turnId);

		const normalized = normalizeSuggestions(suggestions, context);
		if (!normalized.length) {
			return;
		}

		const botToken = metadata.botToken;
		const channel = metadata.incidentChannelId ?? metadata.channel;
		if (!botToken || !channel) {
			return;
		}

		const serviceMap = Object.fromEntries(services.map((service) => [service.id, service.name]));
		const { blocks, text } = buildAgentSuggestionBlocks({
			suggestions: normalized,
			incidentId: payload.incidentId,
			turnId,
			serviceMap,
		});

		await step.do(`agent-turn.post:${turnId}`, { retries: { limit: 3, delay: "2 seconds" } }, () => postAgentSuggestions({ botToken, channel, blocks, text }));
	}
}
