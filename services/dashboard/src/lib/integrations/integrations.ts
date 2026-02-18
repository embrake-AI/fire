import type { SlackIntegrationData } from "@fire/db/schema";
import { integration, isSlackIntegrationData, userIntegration } from "@fire/db/schema";
import { createServerFn } from "@tanstack/solid-start";
import { and, eq } from "drizzle-orm";
import { authMiddleware } from "~/lib/auth/auth-middleware";
import { db } from "~/lib/db";
import { fetchSlackBotChannels, fetchSlackEmojis } from "~/lib/slack";
import { mustGetEnv, sign } from "~/lib/utils/server";

/**
 * Get the Slack integration status for the current user's client.
 */
/**
 * Get the Slack integration status for the current user's client.
 */
export const getWorkspaceIntegrations = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
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
	.middleware([authMiddleware])
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
	.middleware([authMiddleware])
	.inputValidator((data: { platform: "slack" | "notion" | "intercom"; type: "workspace" | "user" }) => data)
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
	.middleware([authMiddleware])
	.inputValidator((data: "slack" | "notion" | "intercom") => data)
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

/**
 * Disconnect a user integration.
 */
export const disconnectUserIntegration = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
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
	.middleware([authMiddleware])
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
	.middleware([authMiddleware])
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
