import type { IS, IS_Event } from "@fire/common";
import { integration } from "@fire/db/schema";
import { createServerFn } from "@tanstack/solid-start";
import { eq } from "drizzle-orm";
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
		const { incidents } = (await response.json()) as { incidents: IS[] };
		return incidents;
	});

export const getIncidentById = createServerFn({ method: "GET" })
	.inputValidator((data: { id: string }) => data)
	.middleware([authMiddleware])
	.handler(async ({ data, context }) => {
		const response = await signedFetch(`${process.env.INCIDENTS_URL}/${data.id}`, { clientId: context.clientId, userId: context.userId });
		if (!response.ok) {
			throw new Error("Failed to fetch incident");
		}
		const incident = (await response.json()) as { state: IS; events: { event_type: string; event_data: string }[] };
		return { state: incident.state, events: incident.events.map((event) => ({ event_type: event.event_type, event_data: JSON.parse(event.event_data) }) as IS_Event) };
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
		const { incident } = (await response.json()) as { incident: IS };
		return incident;
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
		const { incident } = (await response.json()) as { incident: IS };
		return incident;
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
		const { incident } = (await response.json()) as { incident: IS };
		return incident;
	});

export const startIncident = createServerFn({ method: "POST" })
	.inputValidator((data: { prompt: string; channel?: SlackChannel["id"] }) => data)
	.middleware([authMiddleware])
	.handler(async ({ data, context }) => {
		let metadata: Record<string, string> | undefined;
		if (data.channel) {
			const [slackIntegration] = await db.select({ data: integration.data }).from(integration).where(eq(integration.clientId, context.clientId)).limit(1);
			const botToken = slackIntegration?.data?.botToken;
			metadata = {
				channel: data.channel,
				botToken,
			};
		}
		const response = await signedFetch(
			process.env.INCIDENTS_URL!,
			{ clientId: context.clientId, userId: context.userId },
			{ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: data.prompt, metadata }) },
		);
		if (!response.ok) {
			throw new Error("Failed to start incident");
		}
		const { incident } = (await response.json()) as { incident: IS };
		return incident;
	});
