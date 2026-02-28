import { incidentAffection, incidentAffectionService, incidentAffectionUpdate, user } from "@fire/db/schema";
import { and, eq } from "drizzle-orm";
import { getDB } from "../lib/db";
import type { SenderParams } from "./workflow";

export const incidentStarted = undefined;
export const incidentSeverityUpdated = undefined;
export const incidentAssigneeUpdated = undefined;
export const messageAdded = undefined;
export const similarIncident = undefined;

export async function affectionUpdated(params: SenderParams["affectionUpdated"]): Promise<void> {
	const { step, env, id, event, metadata, sourceAdapter } = params;
	const db = getDB(env.db);
	let createdBy: string | null = event.createdBy;
	if (sourceAdapter === "slack" && event.createdBy) {
		const [match] = await db
			.select({ id: user.id })
			.from(user)
			.where(and(eq(user.slackId, event.createdBy), eq(user.clientId, metadata.clientId)))
			.limit(1);
		createdBy = match?.id ?? null;
	} else if (sourceAdapter === "fire") {
		createdBy = null;
	}

	await step(
		"status-page.affection.update",
		{
			retries: {
				limit: 3,
				delay: "2 seconds",
			},
		},
		async () => {
			const now = new Date();
			await db.transaction(async (tx) => {
				const [existing] = await tx
					.select({
						id: incidentAffection.id,
						resolvedAt: incidentAffection.resolvedAt,
					})
					.from(incidentAffection)
					.where(eq(incidentAffection.incidentId, id))
					.limit(1);

				let affectionId = existing?.id;
				if (!affectionId) {
					if (!event.title || !event.services?.length) {
						throw new Error("Missing affection title or services for creation");
					}
					const [created] = await tx
						.insert(incidentAffection)
						.values({
							incidentId: id,
							title: event.title,
							createdBy,
						})
						.returning({ id: incidentAffection.id });

					affectionId = created.id;

					await tx.insert(incidentAffectionService).values(event.services.map((entry) => ({ affectionId, serviceId: entry.id, impact: entry.impact })));
				}

				await tx.insert(incidentAffectionUpdate).values({
					affectionId,
					status: event.status ?? null,
					message: event.message,
					createdBy,
				});

				const updateFields: { updatedAt: Date; resolvedAt?: Date } = {
					updatedAt: now,
				};
				if (event.status === "resolved" && !existing?.resolvedAt) {
					updateFields.resolvedAt = now;
				}

				await tx.update(incidentAffection).set(updateFields).where(eq(incidentAffection.id, affectionId));
			});
			return true;
		},
	);
}

export async function incidentStatusUpdated(params: SenderParams["incidentStatusUpdated"]): Promise<void> {
	const { step, env, id, incident, message } = params;
	if (incident.status !== "resolved" && incident.status !== "declined") {
		return;
	}
	const db = getDB(env.db);
	const trimmedMessage = message.trim();
	const closureMessage = incident.status === "declined" ? (trimmedMessage ? `Declined: ${trimmedMessage}` : "Declined") : trimmedMessage || null;

	await step(
		"status-page.affection.resolve",
		{
			retries: {
				limit: 3,
				delay: "2 seconds",
			},
		},
		async () => {
			const now = new Date();
			await db.transaction(async (tx) => {
				const [existing] = await tx
					.select({
						id: incidentAffection.id,
						resolvedAt: incidentAffection.resolvedAt,
					})
					.from(incidentAffection)
					.where(eq(incidentAffection.incidentId, id))
					.limit(1);

				if (!existing || existing.resolvedAt) {
					return;
				}

				await tx.insert(incidentAffectionUpdate).values({
					affectionId: existing.id,
					status: "resolved",
					message: closureMessage,
					createdBy: null,
				});

				await tx.update(incidentAffection).set({ resolvedAt: now, updatedAt: now }).where(eq(incidentAffection.id, existing.id));
			});
			return true;
		},
	);
}
