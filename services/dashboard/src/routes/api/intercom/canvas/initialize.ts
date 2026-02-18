import { createFileRoute } from "@tanstack/solid-router";
import { buildIntercomCanvasResponse, verifyIntercomSignature } from "~/lib/intercom/intercom.server";

export const Route = createFileRoute("/api/intercom/canvas/initialize")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const rawBody = await request.text();
				const signature = request.headers.get("x-body-signature");

				if (!verifyIntercomSignature(rawBody, signature)) {
					return new Response("Invalid signature", { status: 401 });
				}

				const response = await buildIntercomCanvasResponse(rawBody);
				return new Response(JSON.stringify(response), {
					status: 200,
					headers: {
						"Content-Type": "application/json",
					},
				});
			},
		},
	},
});
