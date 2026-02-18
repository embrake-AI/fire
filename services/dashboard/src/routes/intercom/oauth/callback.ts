import type { IntercomIntegrationData } from "@fire/db/schema";
import { integration } from "@fire/db/schema";
import { createFileRoute } from "@tanstack/solid-router";
import { and, eq, sql } from "drizzle-orm";
import { db } from "~/lib/db";
import { extractSigned, mustGetEnv } from "~/lib/utils/server";

type IntercomOAuthTokenResponse = {
	access_token?: string;
	token_type?: string;
};

type IntercomMeResponse = {
	app?: {
		id_code?: string;
		name?: string;
		app_id?: string | number;
		id?: string | number;
	};
};

async function fetchIntercomWorkspace(accessToken: string): Promise<{ workspaceId: string; workspaceName: string | null; appId: string }> {
	const meEndpoints = ["https://api.intercom.io/me", "https://api.eu.intercom.io/me", "https://api.au.intercom.io/me"];

	for (const endpoint of meEndpoints) {
		const response = await fetch(endpoint, {
			method: "GET",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				Accept: "application/json",
			},
		});

		if (!response.ok) {
			continue;
		}

		const payload = (await response.json()) as IntercomMeResponse;
		const workspaceId = payload.app?.id_code?.trim();
		if (!workspaceId) {
			continue;
		}

		const workspaceName = payload.app?.name?.trim() || null;
		const appId = String(payload.app?.app_id ?? payload.app?.id ?? workspaceId);
		return { workspaceId, workspaceName, appId };
	}

	throw new Error("Unable to resolve Intercom workspace details");
}

async function workspaceClaimedByAnotherClient(workspaceId: string, clientId: string): Promise<boolean> {
	const [row] = await db
		.select({ id: integration.id })
		.from(integration)
		.where(and(eq(integration.platform, "intercom"), sql`${integration.data} ->> 'workspaceId' = ${workspaceId}`, sql`${integration.clientId} <> ${clientId}`))
		.limit(1);

	return Boolean(row);
}

export const Route = createFileRoute("/intercom/oauth/callback")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const url = new URL(request.url);

				const error = url.searchParams.get("error");
				const code = url.searchParams.get("code");
				const state = url.searchParams.get("state");

				if (error) {
					return new Response(`Intercom installation failed: ${error}`, { status: 400 });
				}

				if (!code || !state) {
					return new Response("Missing code or state", { status: 400 });
				}

				const stateData = extractSigned<{ clientId: string; userId: string; platform?: string; type?: string }>(state);
				if (!stateData) {
					return new Response("Invalid or expired state parameter", { status: 400 });
				}
				if (stateData.platform && stateData.platform !== "intercom") {
					return new Response("Invalid state platform", { status: 400 });
				}
				if (stateData.type && stateData.type !== "workspace") {
					return new Response("Invalid state type", { status: 400 });
				}

				const { clientId: tenantClientId, userId } = stateData;

				const tokenResponse = await fetch("https://api.intercom.io/auth/eagle/token", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Accept: "application/json",
					},
					body: JSON.stringify({
						grant_type: "authorization_code",
						code,
						client_id: mustGetEnv("INTERCOM_CLIENT_ID"),
						client_secret: mustGetEnv("INTERCOM_CLIENT_SECRET"),
						redirect_uri: `${mustGetEnv("VITE_APP_URL")}/intercom/oauth/callback`,
					}),
				});

				if (!tokenResponse.ok) {
					const errorBody = await tokenResponse.text();
					return new Response(`Intercom token exchange failed: ${errorBody || tokenResponse.status}`, { status: 400 });
				}

				const tokenJson = (await tokenResponse.json()) as IntercomOAuthTokenResponse;
				const accessToken = tokenJson.access_token?.trim();
				if (!accessToken) {
					return new Response("Intercom token exchange returned no access token", { status: 400 });
				}

				const workspace = await fetchIntercomWorkspace(accessToken);
				const alreadyConnected = await workspaceClaimedByAnotherClient(workspace.workspaceId, tenantClientId);
				if (alreadyConnected) {
					return new Response("This Intercom workspace is already connected to another Fire workspace.", { status: 409 });
				}

				const intercomData: IntercomIntegrationData = {
					type: "intercom",
					workspaceId: workspace.workspaceId,
					workspaceName: workspace.workspaceName,
					appId: workspace.appId,
					accessToken,
					statusPageId: null,
				};

				await db
					.insert(integration)
					.values({
						clientId: tenantClientId,
						platform: "intercom",
						data: intercomData,
						createdBy: userId,
					})
					.onConflictDoUpdate({
						target: [integration.clientId, integration.platform],
						set: {
							data: intercomData,
							updatedAt: new Date(),
						},
					});

				const redirectTo = new URL("/settings/workspace/integrations?installed=intercom", url.origin);
				return Response.redirect(redirectTo.toString(), 302);
			},
		},
	},
});
