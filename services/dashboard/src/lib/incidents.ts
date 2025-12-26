import type { IS, IS_Event, ListIncidentsElement } from "@fire/common";
import { incidentAnalysis } from "@fire/db/schema";
import { createServerFn } from "@tanstack/solid-start";
import { and, desc, eq } from "drizzle-orm";
import { authMiddleware } from "./auth-middleware";
import { db } from "./db";
import type { SlackChannel } from "./slack";
import { signedFetch } from "./utils/server";

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
			| { state: IS; events: { id: number; event_type: string; event_data: string; created_at: string; adapter: "slack" | "dashboard" }[] }
			| { error: "NOT_FOUND" };
		if ("error" in incident) {
			return { error: incident.error };
		}
		return {
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
	.inputValidator((data: { id: string; assignee: string }) => data)
	.middleware([authMiddleware])
	.handler(async ({ data, context }) => {
		const response = await signedFetch(
			`${process.env.INCIDENTS_URL}/${data.id}/assignee`,
			{ clientId: context.clientId, userId: context.userId },
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ assignee: data.assignee }),
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
						assigneeId: true,
						prompt: true,
						type: true,
						isFallback: true,
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
		// TODO: likely it's better to pass integrations to the incidentd service instead of the bot token
		// Now that we only have slack, it's ok
		if (data.channel) {
			const slackIntegration = client.integrations.find((i) => i.platform === "slack");
			const botToken = slackIntegration?.data?.botToken;
			if (botToken) {
				metadata.botToken = botToken;
			}
		}
		const entryPoints = client.entryPoints.map((ep) => ({
			assignee: ep.assigneeId,
			prompt: ep.prompt,
			isFallback: ep.isFallback,
			// type: ep.type, // For now, not needed at the `incidentd` service
		}));
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
			assignees.add(event.event_data.assignee);
		}
	}

	return {
		timeToFirstResponse,
		timeToAssigneeResponse,
		timeToMitigate,
		totalDuration,
	};
}
