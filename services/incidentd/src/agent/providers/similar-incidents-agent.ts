import type { IS_Event } from "@fire/common";
import { truncate } from "@fire/common";
import { formatAgentEventForPrompt } from "../event-format";
import {
	answerSimilarProviderPrompt,
	type CompletedIncidentCandidate,
	decideSimilarProviderAction,
	formatCandidatesForContext,
	loadCompletedCandidates,
	loadOpenCandidates,
	type OpenIncidentCandidate,
	runDeepDive,
	SIMILAR_PROVIDER_SUMMARIZATION_PROMPT,
	SIMILAR_PROVIDER_SYSTEM_PROMPT,
	type SimilarIncidentCandidate,
} from "../similar-incidents";
import { AgentBase, RUN_STATUS_IDLE, RUN_STATUS_RUNNING } from "./base";
import type { PromptInput, PromptResult } from "./types";

type SimilarIncidentsDiscoveredEvent = Extract<IS_Event, { event_type: "SIMILAR_INCIDENTS_DISCOVERED" }>["event_data"];

const CANDIDATES_LOADED_KEY = "candidatesLoaded";
const CANDIDATES_KEY = "candidates";
const PROMPT_PENDING_KEY = "promptPending";

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

		const context = this.listModelInputItems();
		const questionWithConstraints = question
			? `${question}\n\nAnswer constraints: Only use facts from the conversation above (incident events, similar incidents found, investigation results). Do not speculate or list hypothetical causes, signals, or mitigations. If no similar incidents have been found yet, say so briefly. Keep your response short.`
			: null;
		if (questionWithConstraints) {
			context.push({ role: "user", content: questionWithConstraints });
		}

		let answer = "";
		try {
			answer = await answerSimilarProviderPrompt({
				openaiApiKey: this.env.OPENAI_API_KEY,
				input: context,
			});
		} catch (error) {
			console.error("Similar provider prompt mini-call failed", error);
		}

		if (!answer.trim()) {
			answer = this.latestAssistantStep();
		}

		if (!answer.trim()) {
			return {
				answer: "",
				freshness: "empty",
				asOfEventId: this.getLastProcessedEventId(),
			};
		}

		if (questionWithConstraints) {
			this.appendStep({ role: "user", content: questionWithConstraints, source: "prompt" });
			this.appendStep({ role: "assistant", content: answer.trim(), source: "prompt" });
			// Flag + alarm so processPendingContexts runs an iteration with the new Q&A context
			this.ctx.storage.kv.put<boolean>(PROMPT_PENDING_KEY, true);
			await this.ctx.storage.setAlarm(Date.now() + 200);
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

		const hasPendingEvents = this.getLastProcessedEventId() < this.getMaxQueuedToEventId();
		const hasPromptPending = this.ctx.storage.kv.get<boolean>(PROMPT_PENDING_KEY) === true;

		if (!hasPendingEvents && !hasPromptPending) {
			return;
		}

		await this.ensureCandidatesLoaded();

		const runId = `similar:${Date.now()}`;
		this.setRunStatus(RUN_STATUS_RUNNING);
		try {
			// Process pending event batches
			while (this.getLastProcessedEventId() < this.getMaxQueuedToEventId()) {
				const toEventId = this.getMaxQueuedToEventId();
				await this.runSingleIteration(runId, toEventId);
				this.setLastProcessedEventId(toEventId);
			}

			// Run once more if a prompt added new context to the step history
			if (hasPromptPending) {
				this.ctx.storage.kv.delete(PROMPT_PENDING_KEY);
				await this.runSingleIteration(runId, this.getLastProcessedEventId());
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

	private async ensureCandidatesLoaded() {
		if (this.ctx.storage.kv.get<boolean>(CANDIDATES_LOADED_KEY)) {
			return;
		}

		const incident = this.getIncidentStub();
		const context = await incident.getAgentContext();
		if ("error" in context) {
			return;
		}

		let openCandidates: OpenIncidentCandidate[] = [];
		let completedCandidates: CompletedIncidentCandidate[] = [];
		try {
			[openCandidates, completedCandidates] = await Promise.all([
				loadOpenCandidates({ env: this.env, clientId: context.metadata.clientId, incidentId: incident.id.toString() }),
				loadCompletedCandidates({ env: this.env, clientId: context.metadata.clientId, incidentId: incident.id.toString() }),
			]);
		} catch (error) {
			console.error("Failed to load similar incident candidates", error);
			return;
		}

		const candidates: SimilarIncidentCandidate[] = [
			...openCandidates.map((c) => ({ ...c, kind: "open" as const })),
			...completedCandidates.map((c) => ({ ...c, kind: "completed" as const })),
		];

		const candidatesText = formatCandidatesForContext(candidates);
		this.appendStep({
			role: "user",
			content: `Candidate incidents (${openCandidates.length} open, ${completedCandidates.length} completed):\n${candidatesText}`,
			source: "context",
		});

		this.ctx.storage.kv.put<SimilarIncidentCandidate[]>(CANDIDATES_KEY, candidates);
		this.ctx.storage.kv.put<boolean>(CANDIDATES_LOADED_KEY, true);
	}

	private getLoadedCandidates(): SimilarIncidentCandidate[] {
		return this.ctx.storage.kv.get<SimilarIncidentCandidate[]>(CANDIDATES_KEY) ?? [];
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

		// Store function_call steps
		for (const toolCall of decision.toolCalls) {
			this.appendStep({
				role: "function_call",
				name: "investigate_incident",
				toolCallId: toolCall.toolCallId,
				content: toolCall.argumentsText,
				source: "runner",
				runId,
			});
		}

		// Emit SIMILAR_INCIDENTS_DISCOVERED event once before investigations
		const selectedIncidentIds = decision.toolCalls.map((tc) => tc.incidentId);
		await this.emitDiscoveryEvent(runId, toEventId, selectedIncidentIds);

		// Load candidates and run all investigations in parallel
		const candidates = this.getLoadedCandidates();

		const incident = this.getIncidentStub();
		const context = await incident.getAgentContext();
		if ("error" in context) {
			for (const toolCall of decision.toolCalls) {
				this.appendStep({
					role: "tool",
					name: "investigate_incident",
					toolCallId: toolCall.toolCallId,
					content: JSON.stringify({ title: "Unknown", isSimilar: false, similarities: "Incident context unavailable.", learnings: "" }),
					source: "tool-result",
					runId,
				});
			}
			return;
		}

		const knownEventIds = new Set(context.events.map((e) => e.id));
		const deepDiveParams = {
			env: this.env,
			incidentId: incident.id.toString(),
			incident: context.incident,
			metadata: context.metadata,
			persistence: {
				recordAgentContextEvent: (eventType: "SIMILAR_INCIDENTS_DISCOVERED", eventData: SimilarIncidentsDiscoveredEvent, dedupeKey: string) =>
					incident.recordAgentContextEvent({ eventType, eventData, dedupeKey }),
				recordAgentInsightEvent: (eventType: "SIMILAR_INCIDENT", eventData: Extract<IS_Event, { event_type: "SIMILAR_INCIDENT" }>["event_data"], dedupeKey: string) =>
					incident.recordAgentInsightEvent({ eventType, eventData, dedupeKey }),
			},
			knownEventIds,
		};

		const results = await Promise.allSettled(decision.toolCalls.map((toolCall) => runDeepDive(deepDiveParams, runId, toolCall.incidentId, toolCall.reason, candidates)));

		for (const [index, toolCall] of decision.toolCalls.entries()) {
			const result = results[index];
			if (!result || result.status === "rejected") {
				console.error("Similar provider investigation failed", result?.status === "rejected" ? result.reason : undefined);
				this.appendStep({
					role: "tool",
					name: "investigate_incident",
					toolCallId: toolCall.toolCallId,
					content: JSON.stringify({ title: "Unknown", isSimilar: false, similarities: "Investigation failed.", learnings: "" }),
					source: "tool-result",
					runId,
				});
				continue;
			}

			this.appendStep({
				role: "tool",
				name: "investigate_incident",
				toolCallId: toolCall.toolCallId,
				content: result.value.result,
				source: "tool-result",
				runId,
			});
			if (result.value.event) {
				this.appendStep({
					role: "assistant",
					content: formatAgentEventForPrompt(result.value.event),
					source: "runner",
					runId,
				});
			}
		}
	}

	private async emitDiscoveryEvent(runId: string, toEventId: number, selectedIncidentIds: string[]) {
		try {
			const incident = this.getIncidentStub();
			const candidates = this.getLoadedCandidates();
			const openCount = candidates.filter((c) => c.kind === "open").length;
			const closedCount = candidates.filter((c) => c.kind === "completed").length;

			const discoveryEventData: SimilarIncidentsDiscoveredEvent = {
				runId,
				searchedAt: new Date().toISOString(),
				contextSnapshot: `Provider selected ${selectedIncidentIds.length} candidate(s) for deep-dive.`,
				gateDecision: "run",
				openCandidateCount: openCount,
				closedCandidateCount: closedCount,
				rankedIncidentIds: selectedIncidentIds,
				selectedIncidentIds,
			};
			const dedupeKey = `${runId}:${toEventId}`;
			await incident.recordAgentContextEvent({ eventType: "SIMILAR_INCIDENTS_DISCOVERED", eventData: discoveryEventData, dedupeKey });
		} catch (error) {
			console.error("Failed to emit discovery event", error);
		}
	}
}
