import { integration } from "@fire/db/schema";
import { createServerFn } from "@tanstack/solid-start";
import { and, eq } from "drizzle-orm";
import { authMiddleware } from "~/lib/auth-middleware";
import { db } from "~/lib/db";
import { mustGetEnv, sign } from "~/lib/utils/server";

/**
 * Get the Slack integration status for the current user's client.
 */
export const getIntegrations = createServerFn({ method: "GET" })
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
 * Generate the Slack OAuth authorization URL for the current user.
 * Returns the URL to redirect the user to for Slack installation.
 */
export const getInstallUrl = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: "slack") => data)
	.handler(async ({ context, data }) => {
		const { userId, clientId } = context;

		const state = sign({ clientId, userId, integration: data });

		if (data === "slack") {
			const authorize = new URL("https://slack.com/oauth/v2/authorize");
			authorize.searchParams.set("client_id", mustGetEnv("SLACK_CLIENT_ID"));
			authorize.searchParams.set("scope", mustGetEnv("SLACK_BOT_SCOPES"));
			authorize.searchParams.set("redirect_uri", `${mustGetEnv("VITE_APP_URL")}/slack/oauth/callback`);
			authorize.searchParams.set("state", state);

			return authorize.toString();
		}
	});

/**
 * Disconnect the Slack integration for the current user's client.
 * Deletes the integration record from the database.
 */
export const disconnectIntegration = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: "slack") => data)
	.handler(async ({ context, data }) => {
		const { clientId } = context;

		if (!clientId) {
			throw new Error("No client ID found");
		}

		const [result] = await db
			.delete(integration)
			.where(and(eq(integration.clientId, clientId), eq(integration.platform, data)))
			.returning({ data: integration.data });

		if (data === "slack") {
			const revoke = new URL("https://slack.com/api/auth.revoke");
			revoke.searchParams.set("client_id", mustGetEnv("SLACK_CLIENT_ID"));
			revoke.searchParams.set("token", result.data.botToken);
			await fetch(revoke.toString());
		}

		return { success: true };
	});
