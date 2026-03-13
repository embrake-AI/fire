import { createSign } from "node:crypto";
import type { GitHubIntegrationData, GitHubRepositoryConfig, SlackIntegrationData } from "@fire/db/schema";
import { integration, isGitHubIntegrationData, isSlackIntegrationData, userIntegration } from "@fire/db/schema";
import { createServerFn } from "@tanstack/solid-start";
import { and, eq } from "drizzle-orm";
import { authMiddleware } from "~/lib/auth/auth-middleware";
import { requirePermission, requirePermissionFromData } from "~/lib/auth/authorization";
import { db } from "~/lib/db";
import { createUserFacingError } from "~/lib/errors/user-facing-error";
import { fetchSlackBotChannels, fetchSlackEmojis } from "~/lib/slack";
import { mustGetEnv, sign } from "~/lib/utils/server";

type WorkspacePlatform = "slack" | "notion" | "intercom" | "github";

type GitHubInstallResponse = {
	id: number;
	account?: {
		login?: string;
		type?: "User" | "Organization";
	};
	repositories_url?: string;
};

type GitHubInstallationRepositoriesResponse = {
	repositories?: Array<{
		name?: string;
		full_name?: string;
		default_branch?: string;
		description?: string | null;
		owner?: { login?: string };
	}>;
};

export type GitHubWorkspaceConfig = {
	connected: boolean;
	accountLogin: string | null;
	accountType: "User" | "Organization" | null;
	repositories: GitHubRepositoryConfig[];
};

function toBase64Url(value: string) {
	return Buffer.from(value).toString("base64url");
}

function getGitHubPrivateKey() {
	return mustGetEnv("GITHUB_APP_PRIVATE_KEY").replace(/\\n/g, "\n");
}

function createGitHubAppJwt() {
	const now = Math.floor(Date.now() / 1000);
	const header = toBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
	const payload = toBase64Url(
		JSON.stringify({
			iat: now - 60,
			exp: now + 9 * 60,
			iss: mustGetEnv("GITHUB_APP_ID"),
		}),
	);
	const signer = createSign("RSA-SHA256");
	signer.update(`${header}.${payload}`);
	signer.end();
	const signature = signer.sign(getGitHubPrivateKey(), "base64url");
	return `${header}.${payload}.${signature}`;
}

async function fetchGitHubAppJson<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(`https://api.github.com${path}`, {
		...init,
		headers: {
			Accept: "application/vnd.github+json",
			Authorization: `Bearer ${createGitHubAppJwt()}`,
			"X-GitHub-Api-Version": "2022-11-28",
			...(init?.headers ?? {}),
		},
	});

	if (!response.ok) {
		throw new Error(`GitHub app request failed: ${response.status}`);
	}

	return (await response.json()) as T;
}

async function createGitHubInstallationAccessToken(installationId: string): Promise<string> {
	const response = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
		method: "POST",
		headers: {
			Accept: "application/vnd.github+json",
			Authorization: `Bearer ${createGitHubAppJwt()}`,
			"X-GitHub-Api-Version": "2022-11-28",
		},
	});

	if (!response.ok) {
		throw new Error(`GitHub installation token request failed: ${response.status}`);
	}

	const data = (await response.json()) as { token?: string };
	if (!data.token) {
		throw new Error("GitHub installation token missing");
	}
	return data.token;
}

async function fetchGitHubInstallationRepositories(installationId: string): Promise<GitHubRepositoryConfig[]> {
	const token = await createGitHubInstallationAccessToken(installationId);
	const response = await fetch("https://api.github.com/installation/repositories?per_page=100", {
		headers: {
			Accept: "application/vnd.github+json",
			Authorization: `Bearer ${token}`,
			"X-GitHub-Api-Version": "2022-11-28",
		},
	});
	if (!response.ok) {
		throw new Error(`GitHub repositories request failed: ${response.status}`);
	}

	const data = (await response.json()) as GitHubInstallationRepositoriesResponse;
	const repositories = data.repositories ?? [];
	const normalized = repositories
		.map((repo) => {
			const owner = repo.owner?.login?.trim();
			const name = repo.name?.trim();
			const defaultBranch = repo.default_branch?.trim();
			if (!owner || !name || !defaultBranch) {
				return null;
			}
			return {
				owner,
				name,
				defaultBranch,
				fallback: repo.description ?? `${owner}/${name}`,
			};
		})
		.filter((repo): repo is { owner: string; name: string; defaultBranch: string; fallback: string } => !!repo);

	return await Promise.all(
		normalized.map(async (repo) => ({
			owner: repo.owner,
			name: repo.name,
			defaultBranch: repo.defaultBranch,
			description: await fetchGitHubRepositoryDescription({
				token,
				owner: repo.owner,
				name: repo.name,
				fallback: repo.fallback,
			}),
		})),
	);
}

function normalizeGitHubDescription(value: string, fallback: string) {
	const compact = value.replace(/\s+/g, " ").trim();
	if (!compact) {
		return fallback;
	}
	return compact.slice(0, 500);
}

async function fetchGitHubRepositoryDescription(params: { token: string; owner: string; name: string; fallback: string }): Promise<string> {
	const readmeResponse = await fetch(`https://api.github.com/repos/${params.owner}/${params.name}/readme`, {
		headers: {
			Accept: "application/vnd.github.raw+json",
			Authorization: `Bearer ${params.token}`,
			"X-GitHub-Api-Version": "2022-11-28",
		},
	});
	if (readmeResponse.ok) {
		const text = await readmeResponse.text();
		return normalizeGitHubDescription(text, params.fallback);
	}
	return normalizeGitHubDescription(params.fallback, `${params.owner}/${params.name}`);
}

/**
 * Get the Slack integration status for the current user's client.
 */
/**
 * Get the Slack integration status for the current user's client.
 */
export const getWorkspaceIntegrations = createServerFn({ method: "GET" })
	.middleware([authMiddleware, requirePermission("incident.read")])
	.handler(async ({ context }) => {
		const { clientId } = context;

		const results = await db.select({ platform: integration.platform, installedAt: integration.installedAt }).from(integration).where(eq(integration.clientId, clientId));

		return results.map((result) => ({
			platform: result.platform,
			installedAt: result.installedAt,
		}));
	});

/**
 * Get the Slack integration status for the current user.
 */
export const getUserIntegrations = createServerFn({ method: "GET" })
	.middleware([authMiddleware, requirePermission("incident.read")])
	.handler(async ({ context }) => {
		const { userId } = context;

		const results = await db
			.select({ platform: userIntegration.platform, installedAt: userIntegration.installedAt })
			.from(userIntegration)
			.where(eq(userIntegration.userId, userId));

		return results.map((result) => ({
			platform: result.platform,
			installedAt: result.installedAt,
		}));
	});

/**
 * Generate the Slack OAuth authorization URL for the current user.
 * Returns the URL to redirect the user to for Slack installation.
 */
export const getInstallUrl = createServerFn({ method: "POST" })
	.middleware([
		authMiddleware,
		requirePermissionFromData<{ platform: WorkspacePlatform; type: "workspace" | "user" }>((input) =>
			input.type === "workspace" ? "settings.workspace.write" : "settings.account.write",
		),
	])
	.inputValidator((data: { platform: WorkspacePlatform; type: "workspace" | "user" }) => data)
	.handler(async ({ context, data }) => {
		const { userId, clientId } = context;

		const state = sign({ clientId, userId, platform: data.platform, type: data.type });

		if (data.platform === "slack") {
			const authorize = new URL("https://slack.com/oauth/v2/authorize");
			authorize.searchParams.set("client_id", mustGetEnv("SLACK_CLIENT_ID"));
			if (data.type === "workspace") {
				authorize.searchParams.set("scope", mustGetEnv("SLACK_BOT_SCOPES"));
			} else {
				authorize.searchParams.set("user_scope", "chat:write");
			}
			authorize.searchParams.set("redirect_uri", `${mustGetEnv("VITE_APP_URL")}/slack/oauth/callback`);
			authorize.searchParams.set("state", state);

			return authorize.toString();
		}

		if (data.platform === "notion") {
			const authorize = new URL("https://api.notion.com/v1/oauth/authorize");
			authorize.searchParams.set("client_id", mustGetEnv("NOTION_CLIENT_ID"));
			authorize.searchParams.set("response_type", "code");
			authorize.searchParams.set("owner", "user");
			authorize.searchParams.set("redirect_uri", `${mustGetEnv("VITE_APP_URL")}/notion/oauth/callback`);
			authorize.searchParams.set("state", state);

			return authorize.toString();
		}

		if (data.platform === "intercom") {
			if (data.type !== "workspace") {
				throw new Error("Intercom supports workspace installation only");
			}

			const authorize = new URL("https://app.intercom.com/oauth");
			authorize.searchParams.set("client_id", mustGetEnv("INTERCOM_CLIENT_ID"));
			authorize.searchParams.set("redirect_uri", `${mustGetEnv("VITE_APP_URL")}/intercom/oauth/callback`);
			authorize.searchParams.set("state", state);

			return authorize.toString();
		}

		if (data.platform === "github") {
			if (data.type !== "workspace") {
				throw new Error("GitHub supports workspace installation only");
			}

			const authorize = new URL(`https://github.com/apps/${mustGetEnv("GITHUB_APP_SLUG")}/installations/new`);
			authorize.searchParams.set("state", state);
			return authorize.toString();
		}

		throw new Error("Unsupported integration platform");
	});

/**
 * Disconnect the Slack integration for the current user's client.
 * Deletes the integration record from the database.
 */
/**
 * Disconnect a workspace integration.
 */
export const disconnectWorkspaceIntegration = createServerFn({ method: "POST" })
	.middleware([authMiddleware, requirePermission("settings.workspace.write")])
	.inputValidator((data: WorkspacePlatform) => data)
	.handler(async ({ context, data }) => {
		const { clientId } = context;

		if (!clientId) {
			throw new Error("No client ID found");
		}

		const [result] = await db
			.delete(integration)
			.where(and(eq(integration.clientId, clientId), eq(integration.platform, data)))
			.returning({ data: integration.data });

		if (data === "slack" && result?.data) {
			const slackData = result.data as SlackIntegrationData;
			if (!isSlackIntegrationData(slackData)) {
				return { success: true };
			}
			if (slackData.botToken) {
				const revoke = new URL("https://slack.com/api/auth.revoke");
				revoke.searchParams.set("client_id", mustGetEnv("SLACK_CLIENT_ID"));
				revoke.searchParams.set("token", slackData.botToken);
				await fetch(revoke.toString());
			}
		}
		// Note: Notion and Intercom do not currently use a token revocation endpoint here.

		return { success: true };
	});

export const getGitHubWorkspaceConfig = createServerFn({ method: "GET" })
	.middleware([authMiddleware, requirePermission("settings.workspace.read")])
	.handler(async ({ context }): Promise<GitHubWorkspaceConfig> => {
		const [githubIntegration] = await db
			.select({ data: integration.data })
			.from(integration)
			.where(and(eq(integration.clientId, context.clientId), eq(integration.platform, "github")))
			.limit(1);

		if (!githubIntegration?.data || !isGitHubIntegrationData(githubIntegration.data)) {
			return {
				connected: false,
				accountLogin: null,
				accountType: null,
				repositories: [],
			};
		}

		return {
			connected: true,
			accountLogin: githubIntegration.data.accountLogin,
			accountType: githubIntegration.data.accountType,
			repositories: githubIntegration.data.repositories,
		};
	});

export const updateGitHubRepositoryDescriptions = createServerFn({ method: "POST" })
	.middleware([authMiddleware, requirePermission("settings.workspace.write")])
	.inputValidator((data: { repositories: Array<{ owner: string; name: string; description: string }> }) => data)
	.handler(async ({ context, data }) => {
		const updates = new Map(data.repositories.map((repo) => [`${repo.owner}/${repo.name}`, repo.description]));
		if (!updates.size) {
			throw createUserFacingError("At least one repository description is required.");
		}

		const [existing] = await db
			.select({ id: integration.id, data: integration.data })
			.from(integration)
			.where(and(eq(integration.clientId, context.clientId), eq(integration.platform, "github")))
			.limit(1);

		if (!existing?.data || !isGitHubIntegrationData(existing.data)) {
			throw createUserFacingError("Connect GitHub before editing repository descriptions.");
		}

		const repositories = existing.data.repositories.map((repo) => ({
			...repo,
			description: normalizeGitHubDescription(updates.get(`${repo.owner}/${repo.name}`) ?? repo.description, `${repo.owner}/${repo.name}`),
		}));

		await db
			.update(integration)
			.set({
				data: {
					...existing.data,
					repositories,
				},
				updatedAt: new Date(),
			})
			.where(eq(integration.id, existing.id));

		return { success: true };
	});

/**
 * Disconnect a user integration.
 */
export const disconnectUserIntegration = createServerFn({ method: "POST" })
	.middleware([authMiddleware, requirePermission("settings.account.write")])
	.inputValidator((data: "slack") => data)
	.handler(async ({ context, data }) => {
		const { userId } = context;

		const [result] = await db
			.delete(userIntegration)
			.where(and(eq(userIntegration.userId, userId), eq(userIntegration.platform, data)))
			.returning({ data: userIntegration.data });

		if (data === "slack" && result?.data?.userToken) {
			const revoke = new URL("https://slack.com/api/auth.revoke");
			revoke.searchParams.set("client_id", mustGetEnv("SLACK_CLIENT_ID"));
			revoke.searchParams.set("token", result.data.userToken);
			await fetch(revoke.toString());
		}

		return { success: true };
	});

/**
 * Get channels where the Slack bot is a member.
 * Returns an empty array if Slack is not connected.
 */
export const getSlackBotChannels = createServerFn({ method: "GET" })
	.middleware([authMiddleware, requirePermission("catalog.read")])
	.handler(async ({ context }) => {
		const { clientId } = context;

		const [slackIntegration] = await db
			.select()
			.from(integration)
			.where(and(eq(integration.clientId, clientId), eq(integration.platform, "slack")))
			.limit(1);

		if (!slackIntegration?.data) {
			return [];
		}

		const slackData = slackIntegration.data as SlackIntegrationData;
		if (!isSlackIntegrationData(slackData) || !slackData.botToken) {
			return [];
		}

		return fetchSlackBotChannels(slackData.botToken);
	});

/**
 * Get custom emojis from the Slack workspace.
 * Returns an empty object if Slack is not connected.
 */
export const getSlackEmojis = createServerFn({ method: "GET" })
	.middleware([authMiddleware, requirePermission("incident.read")])
	.handler(async ({ context }) => {
		const { clientId } = context;

		const [slackIntegration] = await db
			.select()
			.from(integration)
			.where(and(eq(integration.clientId, clientId), eq(integration.platform, "slack")))
			.limit(1);

		if (!slackIntegration?.data) {
			return {};
		}

		const slackData = slackIntegration.data as SlackIntegrationData;
		if (!isSlackIntegrationData(slackData) || !slackData.botToken) {
			return {};
		}

		return fetchSlackEmojis(slackData.botToken);
	});

export async function installGitHubWorkspaceIntegration(params: { clientId: string; userId: string; installationId: string }) {
	const installation = await fetchGitHubAppJson<GitHubInstallResponse>(`/app/installations/${params.installationId}`);
	const repositories = await fetchGitHubInstallationRepositories(params.installationId);

	const githubData: GitHubIntegrationData = {
		type: "github",
		installationId: String(installation.id),
		accountLogin: installation.account?.login?.trim() ?? "",
		accountType: installation.account?.type === "Organization" ? "Organization" : "User",
		repositories,
	};

	await db
		.insert(integration)
		.values({
			clientId: params.clientId,
			platform: "github",
			data: githubData,
			createdBy: params.userId,
		})
		.onConflictDoUpdate({
			target: [integration.clientId, integration.platform],
			set: {
				data: githubData,
				updatedAt: new Date(),
			},
		});
}
