import { createFileRoute } from "@tanstack/solid-router";
import { auth } from "~/lib/auth/auth";
import { uploadImageFile, uploadImageFromUrl } from "~/lib/blob";

export const Route = createFileRoute("/api/upload/team-image")({
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
				const prefix = `teams/${clientId}/${userId}`;
				let uploadedUrl: string | null = null;

				if (file instanceof File) {
					uploadedUrl = await uploadImageFile(file, prefix);
				} else if (typeof url === "string" && url.trim()) {
					uploadedUrl = await uploadImageFromUrl(url.trim(), prefix);
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
