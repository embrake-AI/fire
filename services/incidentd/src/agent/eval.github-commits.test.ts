/**
 * Evaluation harness for the github-commits provider.
 *
 * This harness is agent-like rather than prompt-only:
 * - it uses the real provider system prompt
 * - it exposes the real tool schemas
 * - it executes a multi-step tool loop against mocked GitHub data
 *
 * Usage:
 *   OPENAI_API_KEY=... bun services/incidentd/src/agent/eval.github-commits.test.ts
 *   OPENAI_API_KEY=... bun services/incidentd/src/agent/eval.github-commits.test.ts --section=agent-loop --runs=3
 *   OPENAI_API_KEY=... bun services/incidentd/src/agent/eval.github-commits.test.ts --section=prompt-answer --runs=3
 *   OPENAI_API_KEY=... bun services/incidentd/src/agent/eval.github-commits.test.ts --out=/tmp/github-eval.json
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { truncate } from "@fire/common";
import OpenAI from "openai";
import {
	buildGitHubCommitsPromptQuestion,
	buildGitHubCommitsTools,
	formatGitHubRepositoriesForContext,
	GITHUB_COMMITS_BACKGROUND_INVESTIGATION_PROMPT,
	GITHUB_COMMITS_PROVIDER_SYSTEM_PROMPT,
	type GitHubCommitEvent,
	type GitHubCommitInspection,
} from "./github-commits";
import { isResponsesFunctionToolCall, parseJsonObject } from "./openai";

type EvalSection = "all" | "agent-loop" | "prompt-answer";

type MockRepository = {
	owner: string;
	name: string;
	defaultBranch: string;
	description: string;
	commits: GitHubCommitInspection[];
};

type BaseScenario = {
	id: string;
	name: string;
	question: string;
	incidentContext: string;
	repositories: MockRepository[];
	existingFindings?: GitHubCommitEvent[];
	expectedAnswerKeywords?: string[];
};

type AgentLoopScenario = BaseScenario & {
	section: "agent-loop";
	expected: {
		shouldPersist: boolean;
		repo?: string;
		sha?: string;
		inspectedRepos?: string[];
		inspectedShas?: string[];
		maxPersistedFindings?: number;
	};
};

type PromptAnswerScenario = BaseScenario & {
	section: "prompt-answer";
	expected: {
		shouldCallTools: boolean;
		shouldPersist?: boolean;
		shouldAnswerAfterPersist?: boolean;
	};
};

type Scenario = AgentLoopScenario | PromptAnswerScenario;

type ScenarioRunResult = {
	section: Exclude<EvalSection, "all">;
	scenarioId: string;
	scenarioName: string;
	runIndex: number;
	ok: boolean;
	note: string;
	raw: AgentLoopRunResult;
};

type EvalSummary = {
	createdAt: string;
	model: string;
	section: EvalSection;
	runsPerScenario: number;
	totals: {
		scenarioRuns: number;
		passes: number;
		fails: number;
		passRate: number;
	};
	bySection: Record<Exclude<EvalSection, "all">, { scenarioRuns: number; passes: number; fails: number; passRate: number }>;
	results: ScenarioRunResult[];
};

type ToolTrace = {
	name: string;
	args: Record<string, unknown>;
	output: string;
};

type AgentLoopRunResult = {
	finalAssistantText: string;
	toolTraces: ToolTrace[];
	persistedFindings: GitHubCommitEvent[];
	assistantAfterPersist: boolean;
};

const MAX_AGENT_ITERATIONS = 6;

function normalizeRepoFilter(value: string) {
	return value
		.trim()
		.replace(/^https:\/\/github\.com\//, "")
		.replace(/\/$/, "");
}

function formatPersistedFindingForPrompt(finding: GitHubCommitEvent) {
	return `AGENT_GITHUB_COMMIT repo=${finding.repo} sha=${truncate(finding.sha, 12)} title="${truncate(finding.title, 200)}" summary="${truncate(finding.summary, 320)}" relevance="${truncate(finding.relevance, 240)}"`;
}

function buildInitialInput(scenario: Scenario): OpenAI.Responses.ResponseInputItem[] {
	const items: OpenAI.Responses.ResponseInputItem[] = [
		{ role: "system", content: GITHUB_COMMITS_PROVIDER_SYSTEM_PROMPT },
		{
			role: "user",
			content: `GitHub repositories (${scenario.repositories.length}) for firedash:\n${formatGitHubRepositoriesForContext(scenario.repositories)}`,
		},
		{
			role: "user",
			content: `Incident context: ${scenario.incidentContext}`,
		},
	];

	for (const finding of scenario.existingFindings ?? []) {
		items.push({
			role: "assistant",
			content: formatPersistedFindingForPrompt(finding),
		});
	}

	if (scenario.section === "agent-loop") {
		items.push({
			role: "user",
			content: GITHUB_COMMITS_BACKGROUND_INVESTIGATION_PROMPT,
		});
	} else {
		items.push({
			role: "user",
			content: buildGitHubCommitsPromptQuestion(scenario.question),
		});
	}

	return items;
}

function getRepositoriesForScenario(scenario: Scenario, repositories?: string[]) {
	const repoFilters = new Set((repositories ?? []).map(normalizeRepoFilter));
	return repoFilters.size > 0 ? scenario.repositories.filter((repo) => repoFilters.has(`${repo.owner}/${repo.name}`)) : scenario.repositories;
}

function listRecentCommitsForScenario(
	scenario: Scenario,
	args: Record<string, unknown>,
): Pick<GitHubCommitInspection, "repo" | "sha" | "title" | "author" | "committedAt" | "url">[] {
	const repositories = Array.isArray(args.repositories) ? args.repositories.filter((value): value is string => typeof value === "string") : undefined;
	const since = typeof args.since === "string" ? Date.parse(args.since) : Number.NaN;
	const limitPerRepo = typeof args.limitPerRepo === "number" ? Math.min(Math.max(args.limitPerRepo, 1), 50) : 15;

	return getRepositoriesForScenario(scenario, repositories).flatMap((repo) =>
		repo.commits
			.filter((commit) => Number.isNaN(since) || Date.parse(commit.committedAt) >= since)
			.slice(0, limitPerRepo)
			.map((commit) => ({
				repo: commit.repo,
				sha: commit.sha,
				title: commit.title,
				author: commit.author,
				committedAt: commit.committedAt,
				url: commit.url,
			})),
	);
}

function inspectCommitForScenario(scenario: Scenario, args: Record<string, unknown>) {
	const repo = typeof args.repo === "string" ? normalizeRepoFilter(args.repo) : "";
	const sha = typeof args.sha === "string" ? args.sha.trim() : "";
	if (!repo || !sha) {
		return { error: "repo and sha are required." };
	}

	for (const configuredRepo of scenario.repositories) {
		if (`${configuredRepo.owner}/${configuredRepo.name}` !== repo) {
			continue;
		}
		const commit = configuredRepo.commits.find((entry) => entry.sha === sha);
		if (!commit) {
			return { error: `Commit not found: ${repo}@${sha}` };
		}
		return commit;
	}

	return { error: `Repository not configured: ${repo}` };
}

function parsePersistFindingArgs(args: Record<string, unknown>) {
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

function executeMockTool(params: { scenario: Scenario; toolCall: OpenAI.Responses.ResponseFunctionToolCall; runId: string; persistedFindings: GitHubCommitEvent[] }): {
	output: string;
	followUpAssistant?: string;
} {
	const args = parseJsonObject(params.toolCall.arguments);

	if (params.toolCall.name === "list_recent_commits") {
		const commits = listRecentCommitsForScenario(params.scenario, args);
		return { output: JSON.stringify({ commits }) };
	}

	if (params.toolCall.name === "inspect_commit") {
		return { output: JSON.stringify(inspectCommitForScenario(params.scenario, args)) };
	}

	if (params.toolCall.name === "persist_finding") {
		const parsed = parsePersistFindingArgs(args);
		if (!parsed) {
			return { output: JSON.stringify({ error: "persist_finding requires repo, sha, url, author, committedAt, title, summary, relevance." }) };
		}
		const finding: GitHubCommitEvent = {
			originRunId: params.runId,
			repo: parsed.repo,
			sha: parsed.sha,
			url: parsed.url,
			author: parsed.author,
			committedAt: parsed.committedAt,
			title: parsed.title,
			summary: parsed.summary,
			relevance: parsed.relevance,
		};
		params.persistedFindings.push(finding);
		return {
			output: JSON.stringify({ ok: true, eventId: params.persistedFindings.length, deduped: false }),
			followUpAssistant: formatPersistedFindingForPrompt(finding),
		};
	}

	return { output: JSON.stringify({ error: `Unknown tool: ${params.toolCall.name}` }) };
}

async function runAgentLoopScenario(scenario: Scenario, apiKey: string, model: string, runIndex: number): Promise<AgentLoopRunResult> {
	const client = new OpenAI({ apiKey });
	const input = buildInitialInput(scenario);
	const persistedFindings: GitHubCommitEvent[] = [];
	const toolTraces: ToolTrace[] = [];
	let finalAssistantText = "";
	let assistantAfterPersist = false;
	const runId = `eval:${scenario.id}:run:${runIndex}`;

	for (let iteration = 0; iteration < MAX_AGENT_ITERATIONS; iteration++) {
		const response = await client.responses.create({
			model,
			input,
			tools: buildGitHubCommitsTools(),
			tool_choice: "auto",
			reasoning: { effort: "medium" },
			text: { verbosity: "low" },
		});

		const assistantText = response.output_text.trim();
		if (assistantText) {
			if (persistedFindings.length > 0) {
				assistantAfterPersist = true;
			}
			finalAssistantText = assistantText;
			input.push({ role: "assistant", content: assistantText });
		}

		const toolCalls = (response.output ?? []).filter(isResponsesFunctionToolCall);
		if (!toolCalls.length) {
			break;
		}

		for (const toolCall of toolCalls) {
			const args = parseJsonObject(toolCall.arguments);
			input.push({
				type: "function_call",
				call_id: toolCall.call_id,
				name: toolCall.name,
				arguments: typeof toolCall.arguments === "string" ? toolCall.arguments : "{}",
			});

			const result = executeMockTool({
				scenario,
				toolCall,
				runId,
				persistedFindings,
			});
			toolTraces.push({
				name: toolCall.name,
				args,
				output: result.output,
			});
			input.push({
				type: "function_call_output",
				call_id: toolCall.call_id,
				output: result.output,
			});
			if (result.followUpAssistant) {
				finalAssistantText = result.followUpAssistant;
				input.push({ role: "assistant", content: result.followUpAssistant });
			}
		}
	}

	return {
		finalAssistantText,
		toolTraces,
		persistedFindings,
		assistantAfterPersist,
	};
}

function includesKeywords(value: string, keywords: string[]) {
	const normalized = value.toLowerCase();
	return keywords.filter((keyword) => !normalized.includes(keyword.toLowerCase()));
}

function evaluateAgentLoopScenario(scenario: AgentLoopScenario, result: AgentLoopRunResult) {
	const inspectedRepos = result.toolTraces
		.filter((trace) => trace.name === "inspect_commit")
		.map((trace) => (typeof trace.args.repo === "string" ? normalizeRepoFilter(trace.args.repo) : ""))
		.filter(Boolean);
	const inspectedShas = result.toolTraces
		.filter((trace) => trace.name === "inspect_commit")
		.map((trace) => (typeof trace.args.sha === "string" ? trace.args.sha.trim() : ""))
		.filter(Boolean);

	if (scenario.expected.shouldPersist !== result.persistedFindings.length > 0) {
		return {
			ok: false,
			note: `persisted=${result.persistedFindings.length > 0} expected=${scenario.expected.shouldPersist}`,
		};
	}

	if (scenario.expected.maxPersistedFindings !== undefined && result.persistedFindings.length > scenario.expected.maxPersistedFindings) {
		return {
			ok: false,
			note: `persisted_count=${result.persistedFindings.length} max=${scenario.expected.maxPersistedFindings}`,
		};
	}

	if (scenario.expected.repo) {
		const persistedRepo = result.persistedFindings[0]?.repo;
		if (persistedRepo !== scenario.expected.repo) {
			return {
				ok: false,
				note: `persisted_repo=${persistedRepo ?? "none"} expected=${scenario.expected.repo}`,
			};
		}
	}

	if (scenario.expected.sha) {
		const persistedSha = result.persistedFindings[0]?.sha;
		if (persistedSha !== scenario.expected.sha) {
			return {
				ok: false,
				note: `persisted_sha=${persistedSha ?? "none"} expected=${scenario.expected.sha}`,
			};
		}
	}

	if (scenario.expected.inspectedRepos) {
		for (const repo of scenario.expected.inspectedRepos) {
			if (!inspectedRepos.includes(repo)) {
				return {
					ok: false,
					note: `inspected_repos=[${inspectedRepos.join(",") || "none"}] missing=${repo}`,
				};
			}
		}
	}

	if (scenario.expected.inspectedShas) {
		for (const sha of scenario.expected.inspectedShas) {
			if (!inspectedShas.includes(sha)) {
				return {
					ok: false,
					note: `inspected_shas=[${inspectedShas.join(",") || "none"}] missing=${sha}`,
				};
			}
		}
	}

	if (scenario.expectedAnswerKeywords?.length) {
		const missing = includesKeywords(result.finalAssistantText, scenario.expectedAnswerKeywords);
		if (missing.length) {
			return {
				ok: false,
				note: `missing_answer_keywords=[${missing.join(", ")}]`,
			};
		}
	}

	return {
		ok: true,
		note: `persisted=${result.persistedFindings.length} inspected_repos=[${inspectedRepos.join(",") || "none"}]`,
	};
}

function evaluatePromptAnswerScenario(scenario: PromptAnswerScenario, result: AgentLoopRunResult) {
	const calledTools = result.toolTraces.length > 0;
	if (calledTools !== scenario.expected.shouldCallTools) {
		return {
			ok: false,
			note: `called_tools=${calledTools} expected=${scenario.expected.shouldCallTools}`,
		};
	}

	if (scenario.expected.shouldPersist !== undefined) {
		const persisted = result.persistedFindings.length > 0;
		if (persisted !== scenario.expected.shouldPersist) {
			return {
				ok: false,
				note: `persisted=${persisted} expected=${scenario.expected.shouldPersist}`,
			};
		}
	}

	if (scenario.expected.shouldAnswerAfterPersist !== undefined && result.assistantAfterPersist !== scenario.expected.shouldAnswerAfterPersist) {
		return {
			ok: false,
			note: `assistant_after_persist=${result.assistantAfterPersist} expected=${scenario.expected.shouldAnswerAfterPersist}`,
		};
	}

	if (scenario.expectedAnswerKeywords?.length) {
		const missing = includesKeywords(result.finalAssistantText, scenario.expectedAnswerKeywords);
		if (missing.length) {
			return {
				ok: false,
				note: `missing_answer_keywords=[${missing.join(", ")}]`,
			};
		}
	}

	return {
		ok: true,
		note: `called_tools=${calledTools}`,
	};
}

function computeSectionTotals(results: ScenarioRunResult[], section: Exclude<EvalSection, "all">) {
	const sectionResults = results.filter((result) => result.section === section);
	const passes = sectionResults.filter((result) => result.ok).length;
	const fails = sectionResults.length - passes;
	return {
		scenarioRuns: sectionResults.length,
		passes,
		fails,
		passRate: sectionResults.length ? Number(((passes / sectionResults.length) * 100).toFixed(1)) : 0,
	};
}

const AGENT_LOOP_SCENARIOS: AgentLoopScenario[] = [
	{
		section: "agent-loop",
		id: "deploy-regression",
		name: "Deploy regression persists the relevant API commit",
		question: "What recent commit looks most suspicious?",
		incidentContext:
			"API 5xx errors started three minutes after deploy 1842. On-call suspects rollback logic or release gating in the API worker. Customer impact is broad and concentrated on write traffic.",
		repositories: [
			{
				owner: "firedash",
				name: "api",
				defaultBranch: "main",
				description: "Backend API and worker runtime. Handles deploy gating, rollback orchestration, auth, and write-path request handling.",
				commits: [
					{
						repo: "firedash/api",
						sha: "abc123def456",
						title: "Rollback retry guard",
						message: "Rollback retry guard\n\nAdds a retry guard to rollback logic after failed deploy handoff.",
						author: "alice",
						committedAt: "2026-03-01T11:55:00.000Z",
						url: "https://github.com/firedash/api/commit/abc123def456",
						changedFilesSummary: "src/rollback.ts (modified, +12/-3)\nsrc/deploy/gate.ts (modified, +8/-2)",
						patchSummary: "# src/rollback.ts\n+retry guard around rollback coordinator\n# src/deploy/gate.ts\n+skip rollback cleanup when retry flag present",
					},
					{
						repo: "firedash/api",
						sha: "fed654cba321",
						title: "Bump docs links",
						message: "Bump docs links",
						author: "bob",
						committedAt: "2026-03-01T10:00:00.000Z",
						url: "https://github.com/firedash/api/commit/fed654cba321",
						changedFilesSummary: "README.md (modified, +4/-4)",
						patchSummary: "# README.md\n-doc links\n+new doc links",
					},
				],
			},
			{
				owner: "firedash",
				name: "dashboard",
				defaultBranch: "main",
				description: "Dashboard UI and admin settings. No request-path production traffic.",
				commits: [
					{
						repo: "firedash/dashboard",
						sha: "9999aaaabbbb",
						title: "Adjust settings spacing",
						message: "Adjust settings spacing",
						author: "carol",
						committedAt: "2026-03-01T11:50:00.000Z",
						url: "https://github.com/firedash/dashboard/commit/9999aaaabbbb",
						changedFilesSummary: "src/routes/settings.tsx (modified, +6/-2)",
						patchSummary: "# src/routes/settings.tsx\n+spacing tweak",
					},
				],
			},
		],
		expectedAnswerKeywords: ["rollback retry guard", "firedash/api"],
		expected: {
			shouldPersist: true,
			repo: "firedash/api",
			sha: "abc123def456",
			inspectedRepos: ["firedash/api"],
			inspectedShas: ["abc123def456"],
			maxPersistedFindings: 1,
		},
	},
	{
		section: "agent-loop",
		id: "noisy-commits",
		name: "Noisy recent commits should persist nothing",
		question: "Do any recent commits look relevant to this incident?",
		incidentContext: "A small number of users reported intermittent slowness, but there is no confirmed subsystem, no deploy correlation, and no shared error signature yet.",
		repositories: [
			{
				owner: "firedash",
				name: "api",
				defaultBranch: "main",
				description: "Backend API and worker runtime.",
				commits: [
					{
						repo: "firedash/api",
						sha: "1111aaaa2222",
						title: "Rename internal metric",
						message: "Rename internal metric",
						author: "alice",
						committedAt: "2026-03-01T11:00:00.000Z",
						url: "https://github.com/firedash/api/commit/1111aaaa2222",
						changedFilesSummary: "src/metrics.ts (modified, +2/-2)",
						patchSummary: "# src/metrics.ts\n-metric_old\n+metric_new",
					},
					{
						repo: "firedash/api",
						sha: "3333bbbb4444",
						title: "Update changelog",
						message: "Update changelog",
						author: "bob",
						committedAt: "2026-03-01T10:30:00.000Z",
						url: "https://github.com/firedash/api/commit/3333bbbb4444",
						changedFilesSummary: "CHANGELOG.md (modified, +8/-0)",
						patchSummary: "# CHANGELOG.md\n+notes",
					},
				],
			},
		],
		expectedAnswerKeywords: ["no", "commit"],
		expected: {
			shouldPersist: false,
			maxPersistedFindings: 0,
		},
	},
	{
		section: "agent-loop",
		id: "multi-repo-routing",
		name: "Repo descriptions help the model route to dashboard",
		question: "Which recent commit is most relevant?",
		incidentContext:
			"CSV exports fail in the workspace settings page immediately after a front-end deploy. API traffic and background jobs are healthy. The breakage is isolated to dashboard export UI flows.",
		repositories: [
			{
				owner: "firedash",
				name: "api",
				defaultBranch: "main",
				description: "Backend API and worker runtime. Does not own dashboard export rendering.",
				commits: [
					{
						repo: "firedash/api",
						sha: "api77778888",
						title: "Tune connection reuse",
						message: "Tune connection reuse",
						author: "alice",
						committedAt: "2026-03-01T12:20:00.000Z",
						url: "https://github.com/firedash/api/commit/api77778888",
						changedFilesSummary: "src/db/pool.ts (modified, +5/-2)",
						patchSummary: "# src/db/pool.ts\n+reuse tweak",
					},
				],
			},
			{
				owner: "firedash",
				name: "dashboard",
				defaultBranch: "main",
				description: "Dashboard UI, settings flows, exports, and operator tools.",
				commits: [
					{
						repo: "firedash/dashboard",
						sha: "dash55556666",
						title: "Refactor CSV export dialog state",
						message: "Refactor CSV export dialog state\n\nMoves export-ready gating into client-side settings route.",
						author: "carol",
						committedAt: "2026-03-01T12:25:00.000Z",
						url: "https://github.com/firedash/dashboard/commit/dash55556666",
						changedFilesSummary: "src/routes/settings/export.tsx (modified, +28/-11)\nsrc/lib/export.ts (modified, +10/-4)",
						patchSummary: "# src/routes/settings/export.tsx\n+new export gating path\n# src/lib/export.ts\n+client-only dialog guard",
					},
				],
			},
		],
		expectedAnswerKeywords: ["csv", "firedash/dashboard"],
		expected: {
			shouldPersist: true,
			repo: "firedash/dashboard",
			sha: "dash55556666",
			inspectedRepos: ["firedash/dashboard"],
			inspectedShas: ["dash55556666"],
			maxPersistedFindings: 1,
		},
	},
	{
		section: "agent-loop",
		id: "choose-most-concrete",
		name: "Chooses the most concrete deploy-related commit among multiple plausible API commits",
		question: "Which recent commit is most relevant?",
		incidentContext:
			"API writes started failing four minutes after deploy 1904. On-call suspects release gating, rollback orchestration, or request validation in the API worker. Impact is broad on write traffic.",
		repositories: [
			{
				owner: "firedash",
				name: "api",
				defaultBranch: "main",
				description: "Backend API and worker runtime. Owns release gating, rollback orchestration, request validation, and write-path handlers.",
				commits: [
					{
						repo: "firedash/api",
						sha: "gate11112222",
						title: "Adjust release gate logging",
						message: "Adjust release gate logging",
						author: "alice",
						committedAt: "2026-03-01T11:40:00.000Z",
						url: "https://github.com/firedash/api/commit/gate11112222",
						changedFilesSummary: "src/deploy/logging.ts (modified, +6/-3)",
						patchSummary: "# src/deploy/logging.ts\n+more detailed gate logs",
					},
					{
						repo: "firedash/api",
						sha: "roll33334444",
						title: "Retry rollback handoff on failed gate",
						message: "Retry rollback handoff on failed gate\n\nTouches rollback coordinator and deploy gate fallback.",
						author: "bob",
						committedAt: "2026-03-01T11:58:00.000Z",
						url: "https://github.com/firedash/api/commit/roll33334444",
						changedFilesSummary: "src/rollback.ts (modified, +18/-7)\nsrc/deploy/gate.ts (modified, +12/-5)",
						patchSummary: "# src/rollback.ts\n+retry rollback handoff on failed gate\n# src/deploy/gate.ts\n+fallback branch for failed gate cleanup",
					},
				],
			},
		],
		expectedAnswerKeywords: ["roll33334444", "rollback"],
		expected: {
			shouldPersist: true,
			repo: "firedash/api",
			sha: "roll33334444",
			inspectedRepos: ["firedash/api"],
			inspectedShas: ["roll33334444"],
			maxPersistedFindings: 1,
		},
	},
	{
		section: "agent-loop",
		id: "title-only-trap",
		name: "Suspicious commit title alone should not trigger persistence without an inspected concrete match",
		question: "Which recent commit is most relevant?",
		incidentContext:
			"Workers began returning 429s on write traffic after a deploy. The evidence points to request throttling or rate limiting in the API path. There is no signal that rollback handling is involved.",
		repositories: [
			{
				owner: "firedash",
				name: "api",
				defaultBranch: "main",
				description: "Backend API and worker runtime. Owns request throttling, write-path traffic shaping, and deploy-time runtime behavior.",
				commits: [
					{
						repo: "firedash/api",
						sha: "trap11112222",
						title: "Fix API outage after deploy",
						message: "Fix API outage after deploy\n\nClarifies wording in release notes and incident playbook links.",
						author: "alice",
						committedAt: "2026-03-01T11:46:00.000Z",
						url: "https://github.com/firedash/api/commit/trap11112222",
						changedFilesSummary: "README.md (modified, +8/-4)\ndocs/release-playbook.md (modified, +14/-6)",
						patchSummary: "# README.md\n+clarify deploy notes\n# docs/release-playbook.md\n+incident playbook wording",
					},
					{
						repo: "firedash/api",
						sha: "rate33334444",
						title: "Tighten burst limiter on write endpoints",
						message: "Tighten burst limiter on write endpoints\n\nLowers allowed burst count for POST and PATCH traffic in the API worker.",
						author: "bob",
						committedAt: "2026-03-01T11:58:00.000Z",
						url: "https://github.com/firedash/api/commit/rate33334444",
						changedFilesSummary: "src/rate-limit.ts (modified, +16/-5)\nsrc/routes/write.ts (modified, +7/-2)",
						patchSummary: "# src/rate-limit.ts\n+lower burst limit for write traffic\n# src/routes/write.ts\n+apply tighter limiter to POST and PATCH handlers",
					},
				],
			},
		],
		expectedAnswerKeywords: ["rate33334444", "write"],
		expected: {
			shouldPersist: true,
			repo: "firedash/api",
			sha: "rate33334444",
			inspectedRepos: ["firedash/api"],
			inspectedShas: ["rate33334444"],
			maxPersistedFindings: 1,
		},
	},
];

const PROMPT_ANSWER_SCENARIOS: PromptAnswerScenario[] = [
	{
		section: "prompt-answer",
		id: "recorded-finding",
		name: "Answer should use a recorded GitHub finding without new tool calls",
		question: "Which recent commit looks most relevant?",
		incidentContext: "The incident already has a recorded GitHub finding. Use it to answer the operator question directly unless more evidence is required.",
		repositories: [
			{
				owner: "firedash",
				name: "api",
				defaultBranch: "main",
				description: "Backend API and worker runtime.",
				commits: [],
			},
		],
		existingFindings: [
			{
				originRunId: "github:prior",
				repo: "firedash/api",
				sha: "abc123def456",
				url: "https://github.com/firedash/api/commit/abc123def456",
				author: "alice",
				committedAt: "2026-03-01T11:55:00.000Z",
				title: "Rollback retry guard",
				summary: "Adds a retry guard to the deploy rollback path.",
				relevance: "Touched rollback handling immediately before incident start.",
			},
		],
		expectedAnswerKeywords: ["rollback retry guard", "firedash/api"],
		expected: {
			shouldCallTools: false,
		},
	},
	{
		section: "prompt-answer",
		id: "prompt-persist-then-answer",
		name: "Prompt mode persists a concrete finding and still answers the user",
		question: "Which recent commit looks most relevant, and why?",
		incidentContext:
			"API 5xx errors started three minutes after deploy 1842. On-call suspects rollback logic or release gating in the API worker. Customer impact is broad and concentrated on write traffic.",
		repositories: [
			{
				owner: "firedash",
				name: "api",
				defaultBranch: "main",
				description: "Backend API and worker runtime. Handles deploy gating, rollback orchestration, auth, and write-path request handling.",
				commits: [
					{
						repo: "firedash/api",
						sha: "abc123def456",
						title: "Rollback retry guard",
						message: "Rollback retry guard\n\nAdds a retry guard to rollback logic after failed deploy handoff.",
						author: "alice",
						committedAt: "2026-03-01T11:55:00.000Z",
						url: "https://github.com/firedash/api/commit/abc123def456",
						changedFilesSummary: "src/rollback.ts (modified, +12/-3)\nsrc/deploy/gate.ts (modified, +8/-2)",
						patchSummary: "# src/rollback.ts\n+retry guard around rollback coordinator\n# src/deploy/gate.ts\n+skip rollback cleanup when retry flag present",
					},
				],
			},
		],
		expectedAnswerKeywords: ["rollback retry guard", "firedash/api"],
		expected: {
			shouldCallTools: true,
			shouldPersist: true,
			shouldAnswerAfterPersist: true,
		},
	},
];

async function main() {
	const apiKey = process.env.OPENAI_API_KEY;
	if (!apiKey) {
		throw new Error("OPENAI_API_KEY is required");
	}

	const args = new Map(
		process.argv.slice(2).map((arg) => {
			const [key, value] = arg.replace(/^--/, "").split("=");
			return [key, value ?? "true"];
		}),
	);

	const sectionArg = args.get("section");
	const section: EvalSection = sectionArg === "agent-loop" || sectionArg === "prompt-answer" || sectionArg === "all" ? sectionArg : "all";
	const runsPerScenario = Math.max(1, Number(args.get("runs") ?? "1"));
	const out = args.get("out");
	const model = args.get("model") ?? "gpt-5.4";

	const results: ScenarioRunResult[] = [];
	const scenarios: Scenario[] = [
		...(section === "all" || section === "agent-loop" ? AGENT_LOOP_SCENARIOS : []),
		...(section === "all" || section === "prompt-answer" ? PROMPT_ANSWER_SCENARIOS : []),
	];

	for (const scenario of scenarios) {
		for (let runIndex = 1; runIndex <= runsPerScenario; runIndex++) {
			const result = await runAgentLoopScenario(scenario, apiKey, model, runIndex);
			const evaluation = scenario.section === "agent-loop" ? evaluateAgentLoopScenario(scenario, result) : evaluatePromptAnswerScenario(scenario, result);
			results.push({
				section: scenario.section,
				scenarioId: scenario.id,
				scenarioName: scenario.name,
				runIndex,
				ok: evaluation.ok,
				note: evaluation.note,
				raw: result,
			});
		}
	}

	const totals = {
		scenarioRuns: results.length,
		passes: results.filter((result) => result.ok).length,
		fails: results.filter((result) => !result.ok).length,
		passRate: results.length ? Number(((results.filter((result) => result.ok).length / results.length) * 100).toFixed(1)) : 0,
	};

	const summary: EvalSummary = {
		createdAt: new Date().toISOString(),
		model,
		section,
		runsPerScenario,
		totals,
		bySection: {
			"agent-loop": computeSectionTotals(results, "agent-loop"),
			"prompt-answer": computeSectionTotals(results, "prompt-answer"),
		},
		results,
	};

	console.log(JSON.stringify(summary, null, 2));

	if (out) {
		const absolute = resolve(out);
		await mkdir(dirname(absolute), { recursive: true });
		await writeFile(absolute, JSON.stringify(summary, null, 2));
	}
}

void main();
