import { apiKey, entryPoint, incidentAnalysis, rotation, team } from "@fire/db/schema";
import { createFileRoute } from "@tanstack/solid-router";
import { subMonths } from "date-fns";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { auth } from "~/lib/auth/auth";
import { forbiddenJsonResponse, isAllowed } from "~/lib/auth/authorization";
import { db } from "~/lib/db";
import { computeIncidentMetrics } from "~/lib/incidents/incidents";
import { sha256 } from "~/lib/utils/server";

/**
 * Incident Metrics API
 *
 * GET /api/metrics
 *
 * Query params:
 * - startDate: ISO date string (default: 2 months ago)
 * - endDate: ISO date string (default: now)
 * - teamId: UUID of team to filter by (optional)
 * - includeRejected: include rejected/declined incidents when "true" or "1" (default: false)
 *
 * Returns incident data with computed metrics for integration with
 * upstream systems or external dashboards.
 */
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
					const role = session.user.role;
					if (!isAllowed(role, "metricsApi.read")) {
						return forbiddenJsonResponse();
					}
					clientId = session.user.clientId;
				}

				const url = new URL(request.url);
				const startDateParam = url.searchParams.get("startDate");
				const endDateParam = url.searchParams.get("endDate");
				const teamIdParam = url.searchParams.get("teamId");
				const includeRejectedParam = url.searchParams.get("includeRejected");
				const includeRejected = includeRejectedParam === "true" || includeRejectedParam === "1";

				// Default: endDate = now, startDate = 2 months back (matching tech KPI convention)
				const now = new Date();
				const endDate = endDateParam ? new Date(endDateParam) : now;
				const startDate = startDateParam ? new Date(startDateParam) : subMonths(now, 2);

				if (startDateParam && Number.isNaN(startDate.getTime())) {
					return new Response(JSON.stringify({ error: "Invalid 'startDate' format. Use ISO date string." }), {
						status: 400,
						headers: { "Content-Type": "application/json" },
					});
				}
				if (endDateParam && Number.isNaN(endDate.getTime())) {
					return new Response(JSON.stringify({ error: "Invalid 'endDate' format. Use ISO date string." }), {
						status: 400,
						headers: { "Content-Type": "application/json" },
					});
				}

				const conditions = [eq(incidentAnalysis.clientId, clientId), gte(incidentAnalysis.resolvedAt, startDate), lte(incidentAnalysis.resolvedAt, endDate)];

				if (teamIdParam) {
					conditions.push(eq(incidentAnalysis.teamId, teamIdParam));
				}
				if (!includeRejected) {
					conditions.push(eq(incidentAnalysis.terminalStatus, "resolved"));
				}

				const incidents = await db
					.select({
						incident: incidentAnalysis,
						entryPointPrompt: entryPoint.prompt,
						rotationName: rotation.name,
						teamName: team.name,
					})
					.from(incidentAnalysis)
					.leftJoin(entryPoint, eq(incidentAnalysis.entryPointId, entryPoint.id))
					.leftJoin(rotation, eq(incidentAnalysis.rotationId, rotation.id))
					.leftJoin(team, eq(incidentAnalysis.teamId, team.id))
					.where(and(...conditions))
					.orderBy(desc(incidentAnalysis.resolvedAt))
					.limit(100);

				const results = incidents
					.map(({ incident, entryPointPrompt, rotationName, teamName }) => {
						const metrics = computeIncidentMetrics(incident);
						return {
							id: incident.id,
							title: incident.title,
							severity: incident.severity,
							assignee: incident.assignee,
							createdAt: incident.createdAt,
							resolvedAt: incident.resolvedAt,
							entryPointId: incident.entryPointId,
							entryPointPrompt,
							rotationId: incident.rotationId,
							rotationName,
							teamId: incident.teamId,
							teamName,
							terminalStatus: incident.terminalStatus,
							metrics: {
								timeToFirstResponseMs: metrics.timeToFirstResponse,
								timeToAssigneeResponseMs: metrics.timeToAssigneeResponse,
								timeToMitigateMs: metrics.timeToMitigate,
								totalDurationMs: metrics.totalDuration,
							},
						};
					})
					.map(({ terminalStatus: _terminalStatus, ...incident }) => incident);

				return new Response(JSON.stringify({ incidents: results }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			},
		},
	},
});
