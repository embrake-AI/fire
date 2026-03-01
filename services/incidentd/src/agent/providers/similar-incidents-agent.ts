import { truncate } from "@fire/common";
import { formatAgentEventForPrompt } from "../event-format";
import {
	answerSimilarProviderPrompt,
	decideSimilarProviderAction,
	runSimilarIncidentFlow,
	SIMILAR_PROVIDER_SUMMARIZATION_PROMPT,
	SIMILAR_PROVIDER_SYSTEM_PROMPT,
} from "../similar-incidents";
import type { AgentEvent } from "../types";
import { AgentBase, RUN_STATUS_IDLE, RUN_STATUS_RUNNING } from "./base";
import type { PromptInput, PromptResult } from "./types";

export class SimilarIncidentsAgent extends AgentBase {
	readonly providerMeta = {
		name: "similar-incidents",
		description: "Searches for and analyzes similar past incidents to inform investigation",
	};
	readonly systemPrompt = SIMILAR_PROVIDER_SYSTEM_PROMPT;
	readonly summarizationPrompt = SIMILAR_PROVIDER_SUMMARIZATION_PROMPT;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
	}

	async prompt(input: PromptInput): Promise<PromptResult> {
		const question = input.question.trim();
		if (question) {
			this.appendStep({ role: "user", content: question, source: "prompt" });
		}

		let answer = "";
		try {
			answer = await answerSimilarProviderPrompt({
				openaiApiKey: this.env.OPENAI_API_KEY,
				input: this.listModelInputItems(),
			});
		} catch (error) {
			console.error("Similar provider prompt mini-call failed", error);
		}

		if (answer.trim()) {
			this.appendStep({ role: "assistant", content: answer.trim(), source: "runner" });
		} else {
			answer = this.latestAssistantStep();
		}

		await this.ensureRunScheduled();

		if (!answer.trim()) {
			return {
				answer: "",
				freshness: "empty",
				asOfEventId: this.getLastProcessedEventId(),
			};
		}

		const freshness = this.getRunStatus() === RUN_STATUS_RUNNING || this.getLastProcessedEventId() < this.getMaxQueuedToEventId() ? "in_progress" : "fresh";

		return {
			answer: answer.trim(),
			freshness,
			asOfEventId: this.getLastProcessedEventId(),
		};
	}

	async alarm() {
		await this.processPendingContexts();
	}

	private async processPendingContexts() {
		if (this.getRunStatus() === RUN_STATUS_RUNNING) {
			return;
		}

		if (this.getLastProcessedEventId() >= this.getMaxQueuedToEventId()) {
			return;
		}

		const runId = `similar:${Date.now()}`;
		this.setRunStatus(RUN_STATUS_RUNNING);
		try {
			while (this.getLastProcessedEventId() < this.getMaxQueuedToEventId()) {
				const toEventId = this.getMaxQueuedToEventId();
				await this.runSingleIteration(runId, toEventId);
				this.setLastProcessedEventId(toEventId);
			}
		} catch (error) {
			console.error("Similar provider background run failed", error);
		} finally {
			this.setRunStatus(RUN_STATUS_IDLE);
		}

		if (this.getLastProcessedEventId() < this.getMaxQueuedToEventId()) {
			await this.ctx.storage.setAlarm(Date.now() + 200);
		}
	}

	private async runSingleIteration(runId: string, toEventId: number) {
		const decision = await decideSimilarProviderAction({
			openaiApiKey: this.env.OPENAI_API_KEY,
			input: this.listModelInputItems(),
		});

		if (decision.assistantContent) {
			this.appendStep({
				role: "assistant",
				content: truncate(decision.assistantContent, 1_500),
				source: "runner",
				runId,
			});
		}

		if (!decision.toolCalls.length) {
			return;
		}

		for (const toolCall of decision.toolCalls) {
			this.appendStep({
				role: "function_call",
				name: "run_similar_investigation",
				toolCallId: toolCall.toolCallId,
				content: toolCall.argumentsText,
				source: "runner",
				runId,
			});
		}

		const results = await Promise.allSettled(
			decision.toolCalls.map((toolCall) =>
				this.executeInvestigation({
					runId,
					toEventId,
					reason: toolCall.reason,
					evidence: toolCall.evidence,
				}),
			),
		);

		for (const [index, toolCall] of decision.toolCalls.entries()) {
			const result = results[index];
			if (!result || result.status === "rejected") {
				console.error("Similar provider investigation failed", result?.status === "rejected" ? result.reason : undefined);
				this.appendStep({
					role: "tool",
					name: "run_similar_investigation",
					toolCallId: toolCall.toolCallId,
					content: `Investigation failed for toEventId=${toEventId}.`,
					source: "tool-result",
					runId,
				});
				continue;
			}

			this.appendStep({
				role: "tool",
				name: "run_similar_investigation",
				toolCallId: toolCall.toolCallId,
				content: result.value.summary,
				source: "tool-result",
				runId,
			});
			for (const event of result.value.events) {
				this.appendStep({
					role: "assistant",
					content: formatAgentEventForPrompt(event),
					source: "runner",
					runId,
				});
			}
		}
	}

	private async executeInvestigation(params: { runId: string; toEventId: number; reason: string; evidence: string }): Promise<{ summary: string; events: AgentEvent[] }> {
		const incident = this.getIncidentStub();
		const context = await incident.getAgentContext();
		if ("error" in context) {
			return {
				summary: `Skipped investigation: incident context unavailable (${context.error}).`,
				events: [],
			};
		}

		const result = await runSimilarIncidentFlow({
			env: this.env,
			incidentId: incident.id.toString(),
			turnId: `provider-${params.toEventId}`,
			metadata: context.metadata,
			incident: context.incident,
			events: context.events,
			stepDo: async (_name, callback) => callback(),
			persistence: {
				recordAgentContextEvent: (eventType, eventData, dedupeKey) => incident.recordAgentContextEvent({ eventType, eventData, dedupeKey }),
				recordAgentInsightEvent: (eventType, eventData, dedupeKey) => incident.recordAgentInsightEvent({ eventType, eventData, dedupeKey }),
			},
			investigationReason: `${params.reason}. Evidence: ${params.evidence}`,
		});

		return {
			summary: `Similar investigation processed for toEventId=${params.toEventId} with ${result.appendedEvents.length} emitted event(s).`,
			events: result.appendedEvents,
		};
	}
}
