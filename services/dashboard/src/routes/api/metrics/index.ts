import { apiKey, incidentAnalysis } from "@fire/db/schema";
import { createFileRoute } from "@tanstack/solid-router";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { auth } from "~/lib/auth";
import { db } from "~/lib/db";
import { computeIncidentMetrics } from "~/lib/incidents";
import { sha256 } from "~/lib/utils/server";

export const Route = createFileRoute("/api/metrics/")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				let clientId: string | null = null;

				const apiKeyHeader = request.headers.get("X-API-Key");
				if (apiKeyHeader) {
					const keyHash = await sha256(apiKeyHeader);
					const [key] = await db.select().from(apiKey).where(eq(apiKey.keyHash, keyHash));
					if (!key) {
						return new Response(JSON.stringify({ error: "Invalid API key" }), {
							status: 401,
							headers: { "Content-Type": "application/json" },
						});
					}
					clientId = key.clientId;

					void db.update(apiKey).set({ lastUsedAt: new Date() }).where(eq(apiKey.id, key.id)).execute();
				} else {
					const session = await auth.api.getSession({ headers: request.headers });
					if (!session?.user?.clientId) {
						return new Response(JSON.stringify({ error: "Unauthorized" }), {
							status: 401,
							headers: { "Content-Type": "application/json" },
						});
					}
					clientId = session.user.clientId;
				}

				const url = new URL(request.url);
				const fromParam = url.searchParams.get("from");
				const toParam = url.searchParams.get("to");

				const fromDate = fromParam ? new Date(fromParam) : null;
				const toDate = toParam ? new Date(toParam) : null;

				if (fromParam && Number.isNaN(fromDate?.getTime())) {
					return new Response(JSON.stringify({ error: "Invalid 'from' date format" }), {
						status: 400,
						headers: { "Content-Type": "application/json" },
					});
				}
				if (toParam && Number.isNaN(toDate?.getTime())) {
					return new Response(JSON.stringify({ error: "Invalid 'to' date format" }), {
						status: 400,
						headers: { "Content-Type": "application/json" },
					});
				}

				const conditions = [eq(incidentAnalysis.clientId, clientId)];

				if (fromDate) {
					conditions.push(gte(incidentAnalysis.resolvedAt, fromDate));
				}
				if (toDate) {
					conditions.push(lte(incidentAnalysis.resolvedAt, toDate));
				}

				const incidents = await db
					.select()
					.from(incidentAnalysis)
					.where(and(...conditions))
					.orderBy(desc(incidentAnalysis.resolvedAt))
					.limit(100);

				const results = incidents.map((incident) => ({
					id: incident.id,
					title: incident.title,
					severity: incident.severity,
					createdAt: incident.createdAt,
					resolvedAt: incident.resolvedAt,
					metrics: computeIncidentMetrics(incident),
					summary: incident.summary,
				}));

				return new Response(JSON.stringify({ incidents: results }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			},
		},
	},
});
