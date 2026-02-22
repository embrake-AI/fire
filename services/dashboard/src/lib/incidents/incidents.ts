import type { EntryPoint, IS, IS_Event, ListIncidentsElement } from "@fire/common";
import type { SlackIntegrationData } from "@fire/db/schema";
import { entryPoint, incidentAnalysis, integration, rotation, user, userIntegration } from "@fire/db/schema";
import { createServerFn } from "@tanstack/solid-start";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { authMiddleware } from "../auth/auth-middleware";
import { requirePermission } from "../auth/authorization";
import { db } from "../db";
import type { SlackChannel } from "../slack";
import { signedFetch } from "../utils/server";

export const getIncidents = createServerFn({
	method: "GET",
})
	.middleware([authMiddleware, requirePermission("incident.read")])
	.handler(async ({ context }) => {
		const response = await signedFetch(process.env.INCIDENTS_URL!, { clientId: context.clientId, userId: context.userId });
		if (!response.ok) {
			throw new Error("Failed to fetch incidents");
		}
		const { incidents } = (await response.json()) as { incidents: ListIncidentsElement[] };
		return incidents;
	});

export type IncidentEvent = IS_Event & { id: number; created_at: string; adapter: "slack" | "dashboard" | "fire" };
export type IncidentTimelineItem = { created_at: string; text: string };
export type IncidentAction = { id: string; description: string };

export const getIncidentById = createServerFn({ method: "GET" })
	.inputValidator((data: { id: string }) => data)
	.middleware([authMiddleware, requirePermission("incident.read")])
	.handler(async ({ data, context }) => {
		const response = await signedFetch(`${process.env.INCIDENTS_URL}/${data.id}`, { clientId: context.clientId, userId: context.userId });
		if (!response.ok) {
			throw new Error("Failed to fetch incident");
		}
		const incident = (await response.json()) as
			| {
					state: IS;
					events: { id: number; event_type: string; event_data: string; created_at: string; adapter: "slack" | "dashboard" | "fire" }[];
					context: { channel?: string; thread?: string };
			  }
			| { error: "NOT_FOUND" };
		if ("error" in incident) {
			return { error: incident.error };
		}
		return {
			context: incident.context,
			state: incident.state,
			events: incident.events.map(
				(event) =>
					({
						event_type: event.event_type,
						event_data: JSON.parse(event.event_data),
						id: event.id,
						created_at: event.created_at,
						adapter: event.adapter,
					}) as IncidentEvent,
			),
		};
	});

export const updateAssignee = createServerFn({ method: "POST" })
	.inputValidator((data: { id: string; slackId: string }) => data)
	.middleware([authMiddleware, requirePermission("incident.write")])
	.handler(async ({ data, context }) => {
		const response = await signedFetch(
			`${process.env.INCIDENTS_URL}/${data.id}/assignee`,
			{ clientId: context.clientId, userId: context.userId },
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ slackId: data.slackId }),
			},
		);
		if (!response.ok) {
			throw new Error("Failed to update assignee");
		}
	});

export const updateSeverity = createServerFn({ method: "POST" })
	.inputValidator((data: { id: string; severity: IS["severity"] }) => data)
	.middleware([authMiddleware, requirePermission("incident.write")])
	.handler(async ({ data, context }) => {
		const response = await signedFetch(
			`${process.env.INCIDENTS_URL}/${data.id}/severity`,
			{ clientId: context.clientId, userId: context.userId },
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ severity: data.severity }),
			},
		);
		if (!response.ok) {
			throw new Error("Failed to update severity");
		}
	});

export const updateStatus = createServerFn({ method: "POST" })
	.inputValidator((data: { id: string; status: "mitigating" | "resolved"; message: string }) => data)
	.middleware([authMiddleware, requirePermission("incident.write")])
	.handler(async ({ data, context }) => {
		const response = await signedFetch(
			`${process.env.INCIDENTS_URL}/${data.id}/status`,
			{ clientId: context.clientId, userId: context.userId },
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ status: data.status, message: data.message }),
			},
		);
		if (!response.ok) {
			throw new Error("Failed to update status");
		}
	});

export const sendSlackMessage = createServerFn({ method: "POST" })
	.inputValidator((data: { id: string; message: string; messageId: string; sendAsBot?: boolean; dashboardOnly?: boolean }) => data)
	.middleware([authMiddleware, requirePermission("incident.write")])
	.handler(async ({ data, context }) => {
		let slackUserToken: string | undefined;
		let slackUserId: string;

		if (data.dashboardOnly) {
			const [currentUser] = await db.select().from(user).where(eq(user.id, context.userId)).limit(1);
			if (!currentUser?.slackId) {
				throw new Error("Slack user ID not found");
			}
			slackUserId = currentUser.slackId;
		} else if (!data.sendAsBot) {
			const [slackUserIntegration] = await db
				.select()
				.from(userIntegration)
				.where(and(eq(userIntegration.userId, context.userId), eq(userIntegration.platform, "slack")))
				.limit(1);

			if (!slackUserIntegration) {
				throw new Error("Slack user integration not found");
			}
			slackUserToken = slackUserIntegration.data.userToken;
			slackUserId = slackUserIntegration.data.userId;
		} else {
			const [slackIntegration] = await db
				.select()
				.from(integration)
				.where(and(eq(integration.clientId, context.clientId), eq(integration.platform, "slack")))
				.limit(1);

			if (!slackIntegration) {
				throw new Error("Slack integration not found");
			}
			const slackData = slackIntegration.data as SlackIntegrationData;
			slackUserId = slackData.botUserId;
		}

		const response = await signedFetch(
			`${process.env.INCIDENTS_URL}/${data.id}/message`,
			{ clientId: context.clientId, userId: context.userId },
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					message: data.message,
					slackUserId,
					messageId: data.messageId,
					slackUserToken,
				}),
			},
		);

		if (!response.ok) {
			throw new Error("Failed to send message");
		}
		return { success: true };
	});

export const startIncident = createServerFn({ method: "POST" })
	.inputValidator((data: { prompt: string; channel?: SlackChannel["id"] }) => data)
	.middleware([authMiddleware, requirePermission("incident.write")])
	.handler(async ({ data, context }) => {
		const client = await db.query.client.findFirst({
			where: {
				id: context.clientId,
			},
			columns: {},
			with: {
				integrations: {
					columns: {
						data: true,
						platform: true,
					},
				},
				entryPoints: {
					columns: {
						id: true,
						prompt: true,
						type: true,
						isFallback: true,
						rotationId: true,
					},
					with: {
						rotationWithAssignee: {
							with: {
								assignee: {
									columns: {
										id: true,
										slackId: true,
									},
								},
							},
						},
						assignee: {
							columns: {
								id: true,
								slackId: true,
							},
						},
					},
				},
				services: {
					columns: {
						id: true,
						name: true,
						prompt: true,
					},
				},
			},
		});
		if (!client) {
			throw new Error("Client not found");
		}
		const metadata = {
			channel: data.channel,
			clientId: context.clientId,
			botToken: undefined as string | undefined,
		};
		if (data.channel) {
			const slackIntegration = client.integrations.find((i) => i.platform === "slack");
			if (slackIntegration?.data) {
				const slackData = slackIntegration.data as SlackIntegrationData;
				if (slackData.botToken) {
					metadata.botToken = slackData.botToken;
				}
			}
		}
		const entryPoints: EntryPoint[] = client.entryPoints
			.map((ep) => {
				let assignee: { id: string; slackId: string } | undefined;
				if (ep.type === "rotation") {
					if (ep.rotationWithAssignee?.assignee?.slackId) {
						const slackId = ep.rotationWithAssignee.assignee.slackId;
						assignee = {
							slackId,
							id: ep.rotationWithAssignee.assignee.id,
						};
					}
				} else if (ep.assignee) {
					if (ep.assignee.slackId) {
						assignee = {
							slackId: ep.assignee.slackId,
							id: ep.assignee.id,
						};
					}
				}
				if (!assignee) {
					return null;
				}
				return {
					id: ep.id,
					teamId: ep.rotationWithAssignee?.teamId ?? undefined,
					rotationId: ep.rotationId ?? undefined,
					assignee,
					prompt: ep.prompt,
					isFallback: ep.isFallback,
				};
			})
			.filter((ep) => !!ep);
		const services = client.services.map((serviceRow) => ({
			id: serviceRow.id,
			name: serviceRow.name,
			prompt: serviceRow.prompt ?? null,
		}));
		const response = await signedFetch(
			process.env.INCIDENTS_URL!,
			{ clientId: context.clientId, userId: context.userId },
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ prompt: data.prompt, metadata, entryPoints, services }),
			},
		);
		if (!response.ok) {
			throw new Error("Failed to start incident");
		}
		const { id } = (await response.json()) as { id: string };
		return { id };
	});

export type ResolvedIncident = {
	id: string;
	title: string;
	description: string;
	severity: "low" | "medium" | "high";
	createdAt: Date;
	resolvedAt: Date;
};

export const getResolvedIncidents = createServerFn({ method: "GET" })
	.middleware([authMiddleware, requirePermission("metrics.read")])
	.handler(async ({ context }) => {
		const resolved = await db
			.select({
				id: incidentAnalysis.id,
				title: incidentAnalysis.title,
				description: incidentAnalysis.description,
				severity: incidentAnalysis.severity,
				createdAt: incidentAnalysis.createdAt,
				resolvedAt: incidentAnalysis.resolvedAt,
			})
			.from(incidentAnalysis)
			.where(eq(incidentAnalysis.clientId, context.clientId))
			.orderBy(desc(incidentAnalysis.resolvedAt))
			.limit(50);
		// No pagination for now, when someone reaches 50, I'll add it
		return resolved;
	});

export const getAnalysisById = createServerFn({ method: "GET" })
	.inputValidator((data: { id: string }) => data)
	.middleware([authMiddleware, requirePermission("incident.read")])
	.handler(async ({ data, context }) => {
		const analysis = await db.query.incidentAnalysis.findFirst({
			where: {
				id: data.id,
				clientId: context.clientId,
			},
			with: {
				actions: {
					columns: {
						id: true,
						description: true,
					},
					orderBy: (actions, { asc }) => [asc(actions.createdAt)],
				},
			},
		});

		// Return null if not found - analysis might still be calculating
		if (!analysis) {
			return null;
		}
		return analysis;
	});

export type IncidentAnalysisRow = typeof incidentAnalysis.$inferSelect;
export type IncidentAnalysis = IncidentAnalysisRow & { actions: IncidentAction[] };

export function computeIncidentMetrics(analysis: IncidentAnalysisRow) {
	const events = analysis.events;
	if (!events.length) {
		return {
			timeToFirstResponse: null,
			timeToAssigneeResponse: null,
			timeToMitigate: null,
			totalDuration: null,
		};
	}

	// assumes events are ordered
	const startedAt = new Date(events[0].created_at).getTime();

	let timeToFirstResponse: number | null = null;
	let timeToAssigneeResponse: number | null = null;
	let timeToMitigate: number | null = null;
	let totalDuration: number | null = null;
	const assignees = new Set<string>();
	const isSystemMessage = (event: (typeof events)[number]) => event.event_type === "MESSAGE_ADDED" && (!event.event_data.userId || event.event_data.userId === "fire");

	for (const event of events) {
		if (event.event_type === "INCIDENT_CREATED") {
			assignees.add(event.event_data.assignee);
		} else if (event.event_type === "MESSAGE_ADDED") {
			if (isSystemMessage(event)) {
				continue;
			}
			if (timeToFirstResponse === null) {
				timeToFirstResponse = new Date(event.created_at).getTime() - startedAt;
			}
			if (timeToAssigneeResponse === null && assignees.has(event.event_data.userId)) {
				assignees.add(event.event_data.userId);
				timeToAssigneeResponse = new Date(event.created_at).getTime() - startedAt;
			}
		} else if (event.event_type === "STATUS_UPDATE") {
			if (event.event_data.status === "mitigating") {
				timeToMitigate = new Date(event.created_at).getTime() - startedAt;
			} else if (event.event_data.status === "resolved") {
				totalDuration = new Date(event.created_at).getTime() - startedAt;
			}
		} else if (event.event_type === "ASSIGNEE_UPDATE") {
			assignees.add(event.event_data.assignee.slackId);
		}
	}

	return {
		timeToFirstResponse,
		timeToAssigneeResponse,
		timeToMitigate,
		totalDuration,
	};
}

export const getMetrics = createServerFn({ method: "GET" })
	.inputValidator((data: { startDate?: string; endDate?: string; teamId?: string }) => data)
	.middleware([authMiddleware, requirePermission("metrics.read")])
	.handler(async ({ data, context }) => {
		const startDate = data.startDate ? new Date(data.startDate) : null;
		const endDate = data.endDate ? new Date(data.endDate) : null;

		const conditions = [eq(incidentAnalysis.clientId, context.clientId)];
		if (startDate) {
			conditions.push(gte(incidentAnalysis.resolvedAt, startDate));
		}
		if (endDate) {
			conditions.push(lte(incidentAnalysis.resolvedAt, endDate));
		}
		if (data.teamId) {
			conditions.push(eq(incidentAnalysis.teamId, data.teamId));
		}

		const incidents = await db
			.select({
				incident: incidentAnalysis,
				entryPointPrompt: entryPoint.prompt,
				rotationName: rotation.name,
			})
			.from(incidentAnalysis)
			.leftJoin(entryPoint, eq(incidentAnalysis.entryPointId, entryPoint.id))
			.leftJoin(rotation, eq(incidentAnalysis.rotationId, rotation.id))
			.where(and(...conditions))
			.orderBy(desc(incidentAnalysis.resolvedAt))
			.limit(100);

		return incidents.map(({ incident, entryPointPrompt, rotationName }) => ({
			id: incident.id,
			title: incident.title,
			severity: incident.severity,
			assignee: incident.assignee,
			createdAt: incident.createdAt,
			resolvedAt: incident.resolvedAt,
			metrics: computeIncidentMetrics(incident),
			entryPointId: incident.entryPointId,
			rotationId: incident.rotationId,
			teamId: incident.teamId,
			entryPointPrompt,
			rotationName,
		}));
	});
