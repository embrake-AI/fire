import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { buildAgentSuggestionMessages, postAgentSuggestionMessage } from "../agent/slack";
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

		const stepDo = <T extends Rpc.Serializable<T>>(name: string, callback: () => Promise<T>): Promise<T> => step.do(name, { retries: { limit: 3, delay: "5 seconds" } }, callback);

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
		const messages = buildAgentSuggestionMessages({
			suggestions: normalized,
			incidentId: payload.incidentId,
			turnId,
			serviceMap,
		});
		const loggedSuggestions: Array<{ message: string; suggestionId: string; messageId: string; suggestion: (typeof normalized)[number] }> = messages.map((message, index) => {
			const suggestionId = `${payload.incidentId}:${turnId}:${index + 1}`;
			return {
				message: message.text,
				suggestionId,
				messageId: `fire-suggestion:${suggestionId}`,
				suggestion: normalized[index]!,
			};
		});

		await step.do(`agent-turn.store:${turnId}`, { retries: { limit: 3, delay: "2 seconds" } }, async () => {
			const incidentStub = this.env.INCIDENT.get(this.env.INCIDENT.idFromString(payload.incidentId));
			await incidentStub.addSuggestions(loggedSuggestions);
			return null;
		});

		for (const [index, message] of messages.entries()) {
			await step.do(`agent-turn.post:${turnId}:${index + 1}`, { retries: { limit: 3, delay: "2 seconds" } }, () =>
				postAgentSuggestionMessage({ botToken, channel, blocks: message.blocks, text: message.text }),
			);
		}
	}
}
