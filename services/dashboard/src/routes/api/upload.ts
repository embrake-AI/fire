import { createFileRoute } from "@tanstack/solid-router";
import { auth } from "~/lib/auth/auth";
import { forbiddenJsonResponse, isAllowed } from "~/lib/auth/authorization";
import { uploadImageFile, uploadImageFromUrl } from "~/lib/blob";

type UploadType = "user" | "client" | "team" | "service" | "status-page";

function resolveUploadPrefix(type: UploadType, clientId: string, userId: string) {
	const prefixes: Record<UploadType, string> = {
		user: `users/${clientId}/${userId}`,
		client: `workspaces/${clientId}`,
		team: `teams/${clientId}/${userId}`,
		service: `services/${clientId}/${userId}`,
		"status-page": `status-pages/${clientId}`,
	};

	return prefixes[type];
}

export const Route = createFileRoute("/api/upload")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const session = await auth.api.getSession({ headers: request.headers });
				const userId = session?.user?.id;
				const clientId = session?.user?.clientId;
				const role = session?.user?.role;

				if (!userId || !clientId) {
					return new Response(JSON.stringify({ error: "Unauthorized" }), {
						status: 401,
						headers: { "Content-Type": "application/json" },
					});
				}

				const formData = await request.formData();
				const file = formData.get("file");
				const url = formData.get("url");
				const rawType = formData.get("type");
				if (typeof rawType !== "string" || !rawType.trim()) {
					return new Response(JSON.stringify({ error: "Invalid upload type" }), {
						status: 400,
						headers: { "Content-Type": "application/json" },
					});
				}

				if (rawType !== "user" && rawType !== "client" && rawType !== "team" && rawType !== "service" && rawType !== "status-page") {
					return new Response(JSON.stringify({ error: "Invalid upload type" }), {
						status: 400,
						headers: { "Content-Type": "application/json" },
					});
				}

				const requiredPermission = rawType === "user" ? "settings.account.write" : rawType === "client" ? "settings.workspace.write" : ("catalog.write" as const);
				if (!isAllowed(role, requiredPermission)) {
					return forbiddenJsonResponse();
				}

				const resolvedPrefix = resolveUploadPrefix(rawType, clientId, userId);

				let uploadedUrl: string | null = null;

				if (file instanceof File) {
					uploadedUrl = await uploadImageFile(file, resolvedPrefix);
				} else if (typeof url === "string" && url.trim()) {
					uploadedUrl = await uploadImageFromUrl(url.trim(), resolvedPrefix);
				}

				if (!uploadedUrl) {
					return new Response(JSON.stringify({ error: "Image upload failed" }), {
						status: 400,
						headers: { "Content-Type": "application/json" },
					});
				}

				return new Response(JSON.stringify({ url: uploadedUrl }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			},
		},
	},
});
