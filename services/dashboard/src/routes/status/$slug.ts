import { createFileRoute } from "@tanstack/solid-router";
export const Route = createFileRoute("/status/$slug")({
	server: {
		handlers: {
			GET: async ({ params }) => {
				const slug = params.slug;
				if (!slug) {
					return new Response("Not found", { status: 404 });
				}

				const { fetchPublicStatusPageBySlug } = await import("~/lib/status-pages/status-pages.server");
				const data = await fetchPublicStatusPageBySlug(slug);
				if (!data) {
					return new Response("Not found", { status: 404 });
				}

				return new Response(JSON.stringify(data), {
					status: 200,
					headers: {
						"Content-Type": "application/json",
						"Cache-Control": "public, max-age=30, stale-while-revalidate=60",
					},
				});
			},
		},
	},
});
