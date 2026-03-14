import { createSign } from "node:crypto";
import { type IS_Event, truncate } from "@fire/common";
import { type GitHubIntegrationData, integration, isGitHubIntegrationData } from "@fire/db/schema";
import { and, eq } from "drizzle-orm";
import type OpenAI from "openai";
import { getDB } from "../lib/db";

export const GITHUB_COMMITS_PROVIDER_SYSTEM_PROMPT = `You are the github-commits context provider.
You have incident context plus repository descriptions for the workspace.
Use tools to inspect recent commits only when they can help explain the current incident.
Prefer repositories whose descriptions or recent incident evidence match the affected system.
You may call list_recent_commits first, then inspect_commit for promising SHAs, and finish with persist_finding only when a commit is concretely relevant.
Do not persist a finding based on repository descriptions or commit titles alone. Inspect the commit first unless the same commit is already recorded in the conversation.
If a first list_recent_commits call returns no commits but the incident still strongly suggests a recent code change, retry once with a broader or null since value before concluding there is no relevant commit.
When you identify a concrete incident-relevant commit from newly listed or inspected GitHub data, call persist_finding before you stop.
Do not stop at a plain-text answer if this run uncovered a concrete new finding that should be recorded in the incident timeline.
If no commit is relevant, answer briefly with facts only.
When answering questions, use only facts from the conversation, repository descriptions, listed commits, inspected commits, and persisted findings.
Never speculate or suggest actions.`;

export const GITHUB_COMMITS_PROVIDER_SUMMARIZATION_PROMPT =
	"Summarize these new incident events into a concise context update. Focus on affected systems, failure mechanisms, deploy/change suspicion, and impact changes. If no new technical signal appears, summarize the current operational state briefly without speculation.";

export const GITHUB_COMMITS_BACKGROUND_INVESTIGATION_PROMPT =
	"Investigate recent GitHub commits that may explain the current incident. Use tools as needed. Inspect a commit before persisting it unless it is already recorded in the conversation. If your first commit listing is empty but the incident still strongly suggests a recent code change, retry once with a broader or null since value before concluding there is no relevant commit. If this run uncovers a concrete incident-relevant commit, call persist_finding before you stop. If no commit is relevant, answer briefly with facts only.";

export const GITHUB_COMMITS_PROMPT_ANSWER_CONSTRAINTS =
	"Answer constraints: Only use facts from the conversation above, repository descriptions, listed commits, inspected commits, and recorded GitHub findings. Do not speculate or suggest actions. Keep the answer short. Inspect a commit before persisting it unless the same commit is already recorded in the conversation. If this run uncovers a concrete new commit finding that should be recorded for the incident, call persist_finding. After persisting, continue only if you still need to answer the user question. If the answer can be given entirely from already recorded findings, you may answer directly.";

export const GITHUB_COMMITS_PERSIST_FINDING_TOOL_DESCRIPTION =
	"Persist a relevant GitHub commit finding into the incident timeline. Use this when the run identifies a concrete incident-relevant commit that should be recorded. Inspect the commit first unless the same commit is already recorded in the conversation. After persisting, continue only if you still need to answer a direct user question or compare another concrete candidate.";

export function buildGitHubCommitsPromptQuestion(question: string) {
	return `${question}\n\n${GITHUB_COMMITS_PROMPT_ANSWER_CONSTRAINTS}`;
}

export function buildGitHubCommitsTools(): OpenAI.Responses.FunctionTool[] {
	return [
		{
			type: "function",
			name: "list_recent_commits",
			description: "List recent commits from configured GitHub repositories. Use before inspecting specific commits.",
			strict: true,
			parameters: {
				type: "object",
				properties: {
					repositories: { type: ["array", "null"], items: { type: "string" } },
					since: { type: ["string", "null"] },
					limitPerRepo: { type: ["number", "null"] },
				},
				required: ["repositories", "since", "limitPerRepo"],
				additionalProperties: false,
			},
		},
		{
			type: "function",
			name: "inspect_commit",
			description: "Inspect a specific commit in detail, including changed files and a patch summary.",
			strict: true,
			parameters: {
				type: "object",
				properties: {
					repo: { type: "string" },
					sha: { type: "string" },
				},
				required: ["repo", "sha"],
				additionalProperties: false,
			},
		},
		{
			type: "function",
			name: "persist_finding",
			description: GITHUB_COMMITS_PERSIST_FINDING_TOOL_DESCRIPTION,
			strict: true,
			parameters: {
				type: "object",
				properties: {
					repo: { type: "string" },
					sha: { type: "string" },
					url: { type: "string" },
					author: { type: "string" },
					committedAt: { type: "string" },
					title: { type: "string" },
					summary: { type: "string" },
					relevance: { type: "string" },
				},
				required: ["repo", "sha", "url", "author", "committedAt", "title", "summary", "relevance"],
				additionalProperties: false,
			},
		},
	];
}

export type GitHubCommitEvent = Extract<IS_Event, { event_type: "GITHUB_COMMIT" }>["event_data"];

export type GitHubCommitPersistenceApi = {
	recordAgentInsightEvent: (
		eventType: "GITHUB_COMMIT",
		eventData: GitHubCommitEvent,
		dedupeKey: string,
	) => Promise<{ eventId: number; createdAt: string; deduped?: boolean } | { error: string }>;
};

export type GitHubCommitSummary = {
	repo: string;
	sha: string;
	title: string;
	author: string;
	committedAt: string;
	url: string;
};

export type GitHubCommitInspection = GitHubCommitSummary & {
	message: string;
	changedFilesSummary: string;
	patchSummary: string;
};

type GitHubCommitsListResponse = Array<{
	sha?: string;
	html_url?: string;
	commit?: {
		message?: string;
		author?: {
			name?: string;
			date?: string;
		};
	};
	author?: {
		login?: string;
	};
}>;

type GitHubCommitDetailsResponse = {
	sha?: string;
	html_url?: string;
	commit?: {
		message?: string;
		author?: {
			name?: string;
			date?: string;
		};
	};
	author?: {
		login?: string;
	};
	files?: Array<{
		filename?: string;
		status?: string;
		additions?: number;
		deletions?: number;
		patch?: string;
	}>;
};

function getGitHubSecrets(env: Env) {
	const appId = env.GITHUB_APP_ID;
	const privateKey = env.GITHUB_APP_PRIVATE_KEY;

	return {
		appId,
		privateKey: privateKey.replace(/\\n/g, "\n"),
	};
}

function getGitHubPrivateKey(env: Env) {
	return getGitHubSecrets(env).privateKey;
}

function createGitHubAppJwt(env: Env) {
	const { appId } = getGitHubSecrets(env);
	const now = Math.floor(Date.now() / 1000);
	const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
	const payload = Buffer.from(
		JSON.stringify({
			iat: now - 60,
			exp: now + 9 * 60,
			iss: appId,
		}),
	).toString("base64url");
	const signer = createSign("RSA-SHA256");
	signer.update(`${header}.${payload}`);
	signer.end();
	return `${header}.${payload}.${signer.sign(getGitHubPrivateKey(env), "base64url")}`;
}

async function createInstallationAccessToken(env: Env, installationId: string): Promise<string> {
	const response = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
		method: "POST",
		headers: {
			Accept: "application/vnd.github+json",
			Authorization: `Bearer ${createGitHubAppJwt(env)}`,
			"X-GitHub-Api-Version": "2022-11-28",
		},
	});
	if (!response.ok) {
		throw new Error(`GitHub installation token request failed: ${response.status}`);
	}

	const data: { token?: string } = await response.json();
	if (!data.token) {
		throw new Error("GitHub installation token missing");
	}
	return data.token;
}

async function fetchGitHubJson<T>(token: string, path: string): Promise<T> {
	const response = await fetch(`https://api.github.com${path}`, {
		headers: {
			Accept: "application/vnd.github+json",
			Authorization: `Bearer ${token}`,
			"X-GitHub-Api-Version": "2022-11-28",
		},
	});
	if (!response.ok) {
		throw new Error(`GitHub request failed: ${response.status} ${path}`);
	}
	return await response.json();
}

export async function loadGitHubIntegration(params: { env: Env; clientId: string }): Promise<GitHubIntegrationData | null> {
	const db = getDB(params.env.db);
	const [row] = await db
		.select({ data: integration.data })
		.from(integration)
		.where(and(eq(integration.clientId, params.clientId), eq(integration.platform, "github")))
		.limit(1);

	if (!row?.data || !isGitHubIntegrationData(row.data)) {
		return null;
	}

	return row.data;
}

export function formatGitHubRepositoriesForContext(repositories: GitHubIntegrationData["repositories"]) {
	if (!repositories.length) {
		return "(none)";
	}
	return repositories.map((repo) => `- ${repo.owner}/${repo.name} [${repo.defaultBranch}]: ${repo.description}`).join("\n");
}

function normalizeRepoFilter(value: string) {
	return value
		.trim()
		.replace(/^https:\/\/github\.com\//, "")
		.replace(/\/$/, "");
}

function summarizeCommitMessage(message: string) {
	return message.split("\n")[0]?.trim() ?? "";
}

function buildDefaultSince(incidentCreatedAt: string) {
	const createdAt = new Date(incidentCreatedAt);
	const createdMs = Number.isNaN(createdAt.getTime()) ? Date.now() : createdAt.getTime();
	const sinceMs = Math.max(Date.now() - 7 * 24 * 60 * 60 * 1000, createdMs - 24 * 60 * 60 * 1000);
	return new Date(sinceMs).toISOString();
}

export async function listRecentGitHubCommits(params: {
	env: Env;
	integration: GitHubIntegrationData;
	incidentCreatedAt: string;
	repositories?: string[];
	limitPerRepo?: number;
	since?: string;
}): Promise<GitHubCommitSummary[]> {
	const token = await createInstallationAccessToken(params.env, params.integration.installationId);
	const repoFilters = new Set((params.repositories ?? []).map(normalizeRepoFilter));
	const repositories = repoFilters.size > 0 ? params.integration.repositories.filter((repo) => repoFilters.has(`${repo.owner}/${repo.name}`)) : params.integration.repositories;
	const perRepoLimit = Math.min(Math.max(params.limitPerRepo ?? 15, 1), 50);
	const since = params.since?.trim() || buildDefaultSince(params.incidentCreatedAt);

	const results = await Promise.all(
		repositories.map(async (repo) => {
			const data = await fetchGitHubJson<GitHubCommitsListResponse>(
				token,
				`/repos/${repo.owner}/${repo.name}/commits?sha=${encodeURIComponent(repo.defaultBranch)}&per_page=${perRepoLimit}&since=${encodeURIComponent(since)}`,
			);
			return data.map((commit) => ({
				repo: `${repo.owner}/${repo.name}`,
				sha: commit.sha ?? "",
				title: summarizeCommitMessage(commit.commit?.message ?? ""),
				author: commit.author?.login ?? commit.commit?.author?.name ?? "unknown",
				committedAt: commit.commit?.author?.date ?? "",
				url: commit.html_url ?? "",
			}));
		}),
	);

	return results.flat().filter((commit) => commit.sha && commit.title && commit.committedAt && commit.url);
}

export async function inspectGitHubCommit(params: { env: Env; integration: GitHubIntegrationData; repo: string; sha: string }): Promise<GitHubCommitInspection> {
	const repo = params.integration.repositories.find((entry) => `${entry.owner}/${entry.name}` === normalizeRepoFilter(params.repo));
	if (!repo) {
		throw new Error(`Repository not configured: ${params.repo}`);
	}
	const token = await createInstallationAccessToken(params.env, params.integration.installationId);
	const data = await fetchGitHubJson<GitHubCommitDetailsResponse>(token, `/repos/${repo.owner}/${repo.name}/commits/${encodeURIComponent(params.sha)}`);
	const files = data.files ?? [];
	const changedFilesSummary =
		files.length > 0
			? files
					.slice(0, 15)
					.map((file) => `${file.filename ?? "unknown"} (${file.status ?? "modified"}, +${file.additions ?? 0}/-${file.deletions ?? 0})`)
					.join("\n")
			: "(no file details)";
	const patchSummary =
		files.length > 0
			? files
					.slice(0, 10)
					.map((file) => `# ${file.filename ?? "unknown"}\n${truncate(file.patch ?? "", 900)}`)
					.join("\n\n")
			: "(no patch available)";

	return {
		repo: `${repo.owner}/${repo.name}`,
		sha: data.sha ?? params.sha,
		title: summarizeCommitMessage(data.commit?.message ?? ""),
		message: data.commit?.message ?? "",
		author: data.author?.login ?? data.commit?.author?.name ?? "unknown",
		committedAt: data.commit?.author?.date ?? "",
		url: data.html_url ?? "",
		changedFilesSummary,
		patchSummary,
	};
}
