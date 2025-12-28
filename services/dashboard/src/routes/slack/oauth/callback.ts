import { integration, userIntegration } from "@fire/db/schema";
import { createFileRoute } from "@tanstack/solid-router";
import { db } from "~/lib/db";
import { extractSigned, mustGetEnv } from "~/lib/utils/server";

type SlackOAuthAccessResponse = {
	ok: boolean;
	error?: string;
	access_token?: string;
	token_type?: string;
	scope?: string;
	bot_user_id?: string;
	app_id?: string;
	team?: { id: string; name: string };
	enterprise?: { id: string; name: string } | null;
	authed_user?: {
		id?: string;
		scope?: string;
		access_token?: string;
		token_type?: "user";
	};
};

export const Route = createFileRoute("/slack/oauth/callback")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const url = new URL(request.url);

				const error = url.searchParams.get("error");
				const code = url.searchParams.get("code");
				const state = url.searchParams.get("state");

				if (error) {
					return new Response(`Slack installation failed: ${error}`, { status: 400 });
				}

				if (!code || !state) {
					return new Response("Missing code or state", { status: 400 });
				}

				const stateData = extractSigned<{ clientId: string; userId: string }>(state);
				if (!stateData) {
					return new Response("Invalid or expired state parameter", { status: 400 });
				}

				const { clientId: tenantClientId, userId } = stateData;

				const tokenRes = await fetch("https://slack.com/api/oauth.v2.access", {
					method: "POST",
					headers: {
						"Content-Type": "application/x-www-form-urlencoded",
					},
					body: new URLSearchParams({
						code,
						client_id: mustGetEnv("SLACK_CLIENT_ID"),
						client_secret: mustGetEnv("SLACK_CLIENT_SECRET"),
						redirect_uri: `${mustGetEnv("VITE_APP_URL")}/slack/oauth/callback`,
					}),
				});

				const tokenJson = (await tokenRes.json()) as SlackOAuthAccessResponse;

				if (!tokenJson.ok) {
					return new Response(`Slack token exchange failed: ${tokenJson.error ?? "unknown_error"}`, {
						status: 400,
					});
				}

				const teamId = tokenJson.team?.id;
				const teamName = tokenJson.team?.name;
				const appId = tokenJson.app_id;

				const botUserId = tokenJson.bot_user_id;
				const botToken = tokenJson.access_token;
				const botScopes = tokenJson.scope;

				const slackUserId = tokenJson.authed_user?.id;
				const userToken = tokenJson.authed_user?.access_token;
				const userScopes = tokenJson.authed_user?.scope;

				if (!teamId || !teamName || !appId) {
					return new Response("Slack response missing required fields", { status: 500 });
				}

				if (botUserId && botToken && botScopes) {
					await db
						.insert(integration)
						.values({
							clientId: tenantClientId,
							platform: "slack",
							data: {
								teamId,
								teamName,
								enterpriseId: tokenJson.enterprise?.id ?? null,
								appId,
								botUserId,
								botToken,
								botScopes: botScopes.split(","),
							},
							createdBy: userId,
						})
						.onConflictDoUpdate({
							target: [integration.clientId, integration.platform],
							set: {
								data: {
									teamId,
									teamName,
									enterpriseId: tokenJson.enterprise?.id ?? null,
									appId,
									botUserId,
									botToken,
									botScopes: botScopes.split(","),
								},
								updatedAt: new Date(),
							},
						});
				}
				if (slackUserId && userToken && userScopes) {
					await db
						.insert(userIntegration)
						.values({
							userId: userId,
							platform: "slack",
							data: {
								teamId,
								teamName,
								enterpriseId: tokenJson.enterprise?.id ?? null,
								appId,
								userId: slackUserId,
								userToken,
								userScopes: userScopes.split(","),
							},
						})
						.onConflictDoUpdate({
							target: [userIntegration.userId, userIntegration.platform],
							set: {
								data: {
									teamId,
									teamName,
									enterpriseId: tokenJson.enterprise?.id ?? null,
									appId,
									userId: slackUserId,
									userToken,
									userScopes: userScopes.split(","),
								},
								updatedAt: new Date(),
							},
						});
				}

				const redirectTo = new URL("/config/integrations?installed=slack", url.origin);

				return Response.redirect(redirectTo.toString(), 302);
			},
		},
	},
});
