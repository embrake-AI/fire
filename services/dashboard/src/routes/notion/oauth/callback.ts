import type { NotionIntegrationData } from "@fire/db/schema";
import { integration } from "@fire/db/schema";
import { createFileRoute } from "@tanstack/solid-router";
import { db } from "~/lib/db";
import { extractSigned, mustGetEnv } from "~/lib/utils/server";

type NotionOAuthTokenResponse = {
	access_token: string;
	token_type: "bearer";
	bot_id: string;
	workspace_id: string;
	workspace_name: string | null;
	workspace_icon: string | null;
	owner: { type: "user" | "workspace"; user?: { id: string } };
	duplicated_template_id: string | null;
	request_id: string;
};

type NotionOAuthErrorResponse = {
	error: string;
	error_description?: string;
};

export const Route = createFileRoute("/notion/oauth/callback")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const url = new URL(request.url);

				const error = url.searchParams.get("error");
				const code = url.searchParams.get("code");
				const state = url.searchParams.get("state");

				if (error) {
					return new Response(`Notion installation failed: ${error}`, { status: 400 });
				}

				if (!code || !state) {
					return new Response("Missing code or state", { status: 400 });
				}

				const stateData = extractSigned<{ clientId: string; userId: string; platform?: string; type?: string }>(state);
				if (!stateData) {
					return new Response("Invalid or expired state parameter", { status: 400 });
				}
				if (stateData.platform && stateData.platform !== "notion") {
					return new Response("Invalid state platform", { status: 400 });
				}

				const { clientId: tenantClientId, userId } = stateData;

				const credentials = Buffer.from(`${mustGetEnv("NOTION_CLIENT_ID")}:${mustGetEnv("NOTION_CLIENT_SECRET")}`).toString("base64");

				const tokenRes = await fetch("https://api.notion.com/v1/oauth/token", {
					method: "POST",
					headers: {
						Authorization: `Basic ${credentials}`,
						"Content-Type": "application/json",
						"Notion-Version": "2022-06-28",
					},
					body: JSON.stringify({
						grant_type: "authorization_code",
						code,
						redirect_uri: `${mustGetEnv("VITE_APP_URL")}/notion/oauth/callback`,
					}),
				});

				if (!tokenRes.ok) {
					const errorJson = (await tokenRes.json()) as NotionOAuthErrorResponse;
					return new Response(`Notion token exchange failed: ${errorJson.error_description ?? errorJson.error}`, { status: 400 });
				}

				const tokenJson = (await tokenRes.json()) as NotionOAuthTokenResponse;

				const notionData: NotionIntegrationData = {
					type: "notion",
					workspaceId: tokenJson.workspace_id,
					workspaceName: tokenJson.workspace_name,
					workspaceIcon: tokenJson.workspace_icon,
					accessToken: tokenJson.access_token,
					botId: tokenJson.bot_id,
				};

				await db
					.insert(integration)
					.values({
						clientId: tenantClientId,
						platform: "notion",
						data: notionData,
						createdBy: userId,
					})
					.onConflictDoUpdate({
						target: [integration.clientId, integration.platform],
						set: {
							data: notionData,
							updatedAt: new Date(),
						},
					});

				const redirectTo = new URL("/settings/workspace/integrations?installed=notion", url.origin);

				return Response.redirect(redirectTo.toString(), 302);
			},
		},
	},
});
