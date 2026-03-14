import type OpenAI from "openai";
import { callOpenAIWithLogging } from "../../lib/openai-logging";
import { formatAgentEventForPrompt } from "../event-format";
import {
	buildGitHubCommitsPromptQuestion,
	buildGitHubCommitsTools,
	formatGitHubRepositoriesForContext,
	GITHUB_COMMITS_BACKGROUND_INVESTIGATION_PROMPT,
	GITHUB_COMMITS_PROVIDER_SUMMARIZATION_PROMPT,
	GITHUB_COMMITS_PROVIDER_SYSTEM_PROMPT,
	type GitHubCommitEvent,
	inspectGitHubCommit,
	listRecentGitHubCommits,
	loadGitHubIntegration,
} from "../github-commits";
import { isResponsesFunctionToolCall, parseJsonObject } from "../openai";
import type { AgentEvent } from "../types";
import { AgentBase, RUN_STATUS_IDLE, RUN_STATUS_RUNNING } from "./base";
import type { PromptInput, PromptResult } from "./types";

const GITHUB_CONTEXT_LOADED_KEY = "githubContextLoaded";
const GITHUB_INTEGRATION_KEY = "githubIntegration";
const MAX_AGENT_ITERATIONS = 6;

type PersistFindingArgs = {
	repo: string;
	sha: string;
	url: string;
	author: string;
	committedAt: string;
	title: string;
	summary: string;
	relevance: string;
};

function toGitHubAgentEvent(recorded: { eventId: number; createdAt: string }, eventData: GitHubCommitEvent): AgentEvent {
	return {
		id: recorded.eventId,
		event_type: "GITHUB_COMMIT",
		event_data: eventData,
		created_at: recorded.createdAt,
		adapter: "fire",
		event_metadata: null,
	};
}

export class GitHubCommitsAgent extends AgentBase {
	readonly providerMeta = {
		name: "github-commits",
		description: "Inspects recent GitHub commits across configured repositories to find incident-relevant changes",
	};
	readonly systemPrompt = GITHUB_COMMITS_PROVIDER_SYSTEM_PROMPT;
	readonly summarizationPrompt = GITHUB_COMMITS_PROVIDER_SUMMARIZATION_PROMPT;

	async prompt(input: PromptInput): Promise<PromptResult> {
		await this.ensureGitHubContextLoaded();

		const question = input.question.trim();
		if (question) {
			this.appendStep({
				role: "user",
				content: buildGitHubCommitsPromptQuestion(question),
				source: "prompt",
			});
		}

		await this.runAgentLoop(`github-prompt:${Date.now()}`);

		const answer = this.latestAssistantStep().trim();
		if (!answer) {
			return {
				answer: "",
				freshness: "empty",
				asOfEventId: this.getLastProcessedEventId(),
			};
		}

		return {
			answer,
			freshness: "fresh",
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

		await this.ensureGitHubContextLoaded();

		this.setRunStatus(RUN_STATUS_RUNNING);
		const runId = `github:${Date.now()}`;
		try {
			while (this.getLastProcessedEventId() < this.getMaxQueuedToEventId()) {
				const toEventId = this.getMaxQueuedToEventId();
				this.appendStep({
					role: "user",
					content: GITHUB_COMMITS_BACKGROUND_INVESTIGATION_PROMPT,
					source: "runner",
					runId,
				});
				await this.runAgentLoop(runId);
				this.setLastProcessedEventId(toEventId);
			}
		} catch (error) {
			console.error("GitHub commits provider background run failed", error);
		} finally {
			this.setRunStatus(RUN_STATUS_IDLE);
		}

		if (this.getLastProcessedEventId() < this.getMaxQueuedToEventId()) {
			await this.ctx.storage.setAlarm(Date.now() + 200);
		}
	}

	private getStoredGitHubIntegration() {
		return this.ctx.storage.kv.get<Awaited<ReturnType<typeof loadGitHubIntegration>>>(GITHUB_INTEGRATION_KEY) ?? null;
	}

	private async ensureGitHubContextLoaded() {
		if (this.ctx.storage.kv.get<boolean>(GITHUB_CONTEXT_LOADED_KEY)) {
			return;
		}

		const incident = this.getIncidentStub();
		const context = await incident.getAgentContext();
		if ("error" in context) {
			return;
		}

		const githubIntegration = await loadGitHubIntegration({
			env: this.env,
			clientId: context.metadata.clientId,
		});

		if (!githubIntegration) {
			this.appendStep({
				role: "user",
				content: "GitHub integration: not connected for this workspace.",
				source: "context",
			});
			this.ctx.storage.kv.put<boolean>(GITHUB_CONTEXT_LOADED_KEY, true);
			return;
		}

		this.appendStep({
			role: "user",
			content: `GitHub repositories (${githubIntegration.repositories.length}) for ${githubIntegration.accountLogin}:\n${formatGitHubRepositoriesForContext(githubIntegration.repositories)}`,
			source: "context",
		});
		this.ctx.storage.kv.put(GITHUB_INTEGRATION_KEY, githubIntegration);
		this.ctx.storage.kv.put<boolean>(GITHUB_CONTEXT_LOADED_KEY, true);
	}

	private async runAgentLoop(runId: string) {
		for (let iteration = 0; iteration < MAX_AGENT_ITERATIONS; iteration++) {
			const response = await callOpenAIWithLogging({
				openaiApiKey: this.env.OPENAI_API_KEY,
				request: {
					model: "gpt-5.4",
					input: this.listModelInputItems(),
					tools: buildGitHubCommitsTools(),
					tool_choice: "auto",
					reasoning: { effort: "medium" },
					prompt_cache_retention: "24h",
					text: { verbosity: "low" },
				},
				context: {
					operation: "agentProvider.githubCommits.runLoop",
					incidentId: this.incidentId,
					agentName: this.providerMeta.name,
				},
			});

			const assistantText = response.output_text.trim();
			if (assistantText) {
				this.appendStep({
					role: "assistant",
					content: assistantText,
					source: "runner",
					runId,
				});
			}

			const toolCalls = (response.output ?? []).filter(isResponsesFunctionToolCall);
			if (!toolCalls.length) {
				return;
			}

			for (const toolCall of toolCalls) {
				this.appendStep({
					role: "function_call",
					name: toolCall.name,
					toolCallId: toolCall.call_id,
					content: typeof toolCall.arguments === "string" ? toolCall.arguments : "{}",
					source: "runner",
					runId,
				});

				const output = await this.executeTool(toolCall, runId);
				this.appendStep({
					role: "tool",
					name: toolCall.name,
					toolCallId: toolCall.call_id,
					content: output.output,
					source: "tool-result",
					runId,
				});
				if (output.followUpAssistant) {
					this.appendStep({
						role: "assistant",
						content: output.followUpAssistant,
						source: "runner",
						runId,
					});
				}
			}
		}
	}

	private async executeTool(toolCall: OpenAI.Responses.ResponseFunctionToolCall, runId: string): Promise<{ output: string; followUpAssistant?: string }> {
		const args = parseJsonObject(toolCall.arguments);
		const githubIntegration = this.getStoredGitHubIntegration();
		const incident = this.getIncidentStub();
		const context = await incident.getAgentContext();

		if (toolCall.name === "list_recent_commits") {
			if ("error" in context || !githubIntegration) {
				return { output: JSON.stringify({ error: "GitHub integration unavailable." }) };
			}
			try {
				const repositories = Array.isArray(args.repositories) ? args.repositories.filter((value): value is string => typeof value === "string") : undefined;
				const since = typeof args.since === "string" ? args.since : undefined;
				const limitPerRepo = typeof args.limitPerRepo === "number" ? args.limitPerRepo : undefined;
				const commits = await listRecentGitHubCommits({
					env: this.env,
					integration: githubIntegration,
					incidentCreatedAt: context.incident.createdAt,
					repositories,
					since,
					limitPerRepo,
				});
				return { output: JSON.stringify({ commits }) };
			} catch (error) {
				return { output: JSON.stringify({ error: error instanceof Error ? error.message : "Failed to list commits." }) };
			}
		}

		if (toolCall.name === "inspect_commit") {
			if (!githubIntegration) {
				return { output: JSON.stringify({ error: "GitHub integration unavailable." }) };
			}
			const repo = typeof args.repo === "string" ? args.repo : "";
			const sha = typeof args.sha === "string" ? args.sha : "";
			if (!repo || !sha) {
				return { output: JSON.stringify({ error: "repo and sha are required." }) };
			}
			try {
				const commit = await inspectGitHubCommit({
					env: this.env,
					integration: githubIntegration,
					repo,
					sha,
				});
				return { output: JSON.stringify(commit) };
			} catch (error) {
				return { output: JSON.stringify({ error: error instanceof Error ? error.message : "Failed to inspect commit." }) };
			}
		}

		if (toolCall.name === "persist_finding") {
			const parsed = this.parsePersistFindingArgs(args);
			if (!parsed) {
				return { output: JSON.stringify({ error: "persist_finding requires repo, sha, url, author, committedAt, title, summary, relevance." }) };
			}
			try {
				const eventData: GitHubCommitEvent = {
					originRunId: runId,
					repo: parsed.repo,
					sha: parsed.sha,
					url: parsed.url,
					author: parsed.author,
					committedAt: parsed.committedAt,
					title: parsed.title,
					summary: parsed.summary,
					relevance: parsed.relevance,
				};

				const recorded = await incident.recordAgentInsightEvent({
					eventType: "GITHUB_COMMIT",
					eventData,
					dedupeKey: `${runId}:${parsed.repo}:${parsed.sha}`,
				});
				if ("error" in recorded) {
					return { output: JSON.stringify({ error: recorded.error }) };
				}
				return {
					output: JSON.stringify({
						ok: true,
						eventId: recorded.eventId,
						deduped: recorded.deduped ?? false,
					}),
					followUpAssistant: formatAgentEventForPrompt(toGitHubAgentEvent(recorded, eventData)),
				};
			} catch (error) {
				return { output: JSON.stringify({ error: error instanceof Error ? error.message : "Failed to persist finding." }) };
			}
		}

		return { output: JSON.stringify({ error: `Unknown tool: ${toolCall.name}` }) };
	}

	private parsePersistFindingArgs(args: Record<string, unknown>): PersistFindingArgs | null {
		if (
			typeof args.repo !== "string" ||
			typeof args.sha !== "string" ||
			typeof args.url !== "string" ||
			typeof args.author !== "string" ||
			typeof args.committedAt !== "string" ||
			typeof args.title !== "string" ||
			typeof args.summary !== "string" ||
			typeof args.relevance !== "string"
		) {
			return null;
		}

		return {
			repo: args.repo.trim(),
			sha: args.sha.trim(),
			url: args.url.trim(),
			author: args.author.trim(),
			committedAt: args.committedAt.trim(),
			title: args.title.trim(),
			summary: args.summary.trim(),
			relevance: args.relevance.trim(),
		};
	}
}
