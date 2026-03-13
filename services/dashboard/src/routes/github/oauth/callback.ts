import { createFileRoute } from "@tanstack/solid-router";
import { installGitHubWorkspaceIntegration } from "~/lib/integrations/integrations.server";
import { extractSigned } from "~/lib/utils/server";

export const Route = createFileRoute("/github/oauth/callback")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const url = new URL(request.url);
				const installationId = url.searchParams.get("installation_id");
				const state = url.searchParams.get("state");

				if (!installationId || !state) {
					return new Response("Missing installation_id or state", { status: 400 });
				}

				const stateData = extractSigned<{ clientId: string; userId: string; platform?: string; type?: string }>(state);
				if (!stateData) {
					return new Response("Invalid or expired state parameter", { status: 400 });
				}
				if (stateData.platform && stateData.platform !== "github") {
					return new Response("Invalid state platform", { status: 400 });
				}

				await installGitHubWorkspaceIntegration({
					clientId: stateData.clientId,
					userId: stateData.userId,
					installationId,
				});

				const redirectTo = new URL("/settings/workspace/integrations?installed=github", url.origin);
				return Response.redirect(redirectTo.toString(), 302);
			},
		},
	},
});
