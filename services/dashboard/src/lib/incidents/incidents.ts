import type { EntryPoint, IS, IS_Event, ListIncidentsElement } from "@fire/common";
import { entryPoint, incidentAnalysis, rotation, userIntegration } from "@fire/db/schema";
import { createServerFn } from "@tanstack/solid-start";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { authMiddleware } from "../auth/auth-middleware";
import { db } from "../db";
import type { SlackChannel } from "../slack";
import { signedFetch } from "../utils/server";

export const getIncidents = createServerFn({
	method: "GET",
})
	.middleware([authMiddleware])
	.handler(async ({ context }) => {
		const response = await signedFetch(process.env.INCIDENTS_URL!, { clientId: context.clientId, userId: context.userId });
		if (!response.ok) {
			throw new Error("Failed to fetch incidents");
		}
		const { incidents } = (await response.json()) as { incidents: ListIncidentsElement[] };
		return incidents;
	});

export type IncidentEvent = IS_Event & { id: number; created_at: string; adapter: "slack" | "dashboard" };

export const getIncidentById = createServerFn({ method: "GET" })
	.inputValidator((data: { id: string }) => data)
	.middleware([authMiddleware])
	.handler(async ({ data, context }) => {
		const response = await signedFetch(`${process.env.INCIDENTS_URL}/${data.id}`, { clientId: context.clientId, userId: context.userId });
		if (!response.ok) {
			throw new Error("Failed to fetch incident");
		}
		const incident = (await response.json()) as
			| {
					state: IS;
					events: { id: number; event_type: string; event_data: string; created_at: string; adapter: "slack" | "dashboard" }[];
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
	.middleware([authMiddleware])
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
	.middleware([authMiddleware])
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
	.middleware([authMiddleware])
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
	.inputValidator((data: { id: string; message: string; thread_ts: string; channel: string }) => data)
	.middleware([authMiddleware])
	.handler(async ({ data, context }) => {
		const [slackUserIntegration] = await db
			.select()
			.from(userIntegration)
			.where(and(eq(userIntegration.userId, context.userId), eq(userIntegration.platform, "slack")))
			.limit(1);
		if (!slackUserIntegration) {
			throw new Error("Slack user integration not found");
		}
		const { userToken } = slackUserIntegration.data;
		const response = await fetch(`https://slack.com/api/chat.postMessage`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${userToken}`,
			},
			body: JSON.stringify({ channel: data.channel, text: data.message, thread_ts: data.thread_ts }),
		});
		if (!response.ok) {
			throw new Error("Failed to send message to Slack");
		}
		const responseData = await response.json();
		if (!responseData.ok) {
			return { error: responseData.error };
		}
		return { success: true };
	});

export const startIncident = createServerFn({ method: "POST" })
	.inputValidator((data: { prompt: string; channel?: SlackChannel["id"] }) => data)
	.middleware([authMiddleware])
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
			const botToken = slackIntegration?.data?.botToken;
			if (botToken) {
				metadata.botToken = botToken;
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
		const response = await signedFetch(
			process.env.INCIDENTS_URL!,
			{ clientId: context.clientId, userId: context.userId },
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ prompt: data.prompt, metadata, entryPoints }),
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
	.middleware([authMiddleware])
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
	.middleware([authMiddleware])
	.handler(async ({ data, context }) => {
		const [analysis] = await db
			.select()
			.from(incidentAnalysis)
			.where(and(eq(incidentAnalysis.id, data.id), eq(incidentAnalysis.clientId, context.clientId)));

		// Return null if not found - analysis might still be calculating
		return analysis ?? null;
	});

export type IncidentAnalysis = NonNullable<Awaited<ReturnType<typeof getAnalysisById>>>;

export function computeIncidentMetrics(analysis: IncidentAnalysis) {
	const events = analysis.events;

	// assumes events are ordered
	const startedAt = new Date(analysis.events[0].created_at).getTime();

	let timeToFirstResponse: number | null = null;
	let timeToAssigneeResponse: number | null = null;
	let timeToMitigate: number | null = null;
	let totalDuration: number | null = null;
	const assignees = new Set<string>();

	for (const event of events) {
		if (event.event_type === "INCIDENT_CREATED") {
			assignees.add(event.event_data.assignee);
		} else if (event.event_type === "MESSAGE_ADDED") {
			if (timeToFirstResponse === null) {
				timeToFirstResponse = new Date(event.created_at).getTime() - startedAt;
			}
			if (assignees.has(event.event_data.userId)) {
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
	.inputValidator((data: { from?: string; to?: string }) => data)
	.middleware([authMiddleware])
	.handler(async ({ data, context }) => {
		const fromDate = data.from ? new Date(data.from) : null;
		const toDate = data.to ? new Date(data.to) : null;

		const conditions = [eq(incidentAnalysis.clientId, context.clientId)];
		if (fromDate) {
			conditions.push(gte(incidentAnalysis.resolvedAt, fromDate));
		}
		if (toDate) {
			conditions.push(lte(incidentAnalysis.resolvedAt, toDate));
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
			summary: incident.summary,
			entryPointId: incident.entryPointId,
			rotationId: incident.rotationId,
			entryPointPrompt,
			rotationName,
		}));
	});
