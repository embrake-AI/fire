import { createFileRoute } from "@tanstack/solid-router";
import { auth } from "~/lib/auth/auth";
import { uploadImageFile, uploadImageFromUrl } from "~/lib/blob";

type UploadType = "user" | "client" | "team";

function resolveUploadPrefix(type: UploadType, clientId: string, userId: string) {
	const prefixes: Record<UploadType, string> = {
		user: `users/${clientId}/${userId}`,
		client: `workspaces/${clientId}`,
		team: `teams/${clientId}/${userId}`,
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

				if (rawType !== "user" && rawType !== "client" && rawType !== "team") {
					return new Response(JSON.stringify({ error: "Invalid upload type" }), {
						status: 400,
						headers: { "Content-Type": "application/json" },
					});
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
