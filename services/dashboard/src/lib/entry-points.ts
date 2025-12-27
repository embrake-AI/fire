import { entryPoint, integration, rotationWithAssignee } from "@fire/db/schema";
import { createServerFn } from "@tanstack/solid-start";
import { and, desc, eq } from "drizzle-orm";
import { authMiddleware } from "./auth-middleware";
import { db } from "./db";
import { fetchSlackUsers } from "./slack";

export const getEntryPoints = createServerFn({
	method: "GET",
})
	.middleware([authMiddleware])
	.handler(async ({ context }) => {
		const entryPointsWithRotation = await db
			.select({
				id: entryPoint.id,
				type: entryPoint.type,
				prompt: entryPoint.prompt,
				assigneeId: entryPoint.assigneeId,
				rotationId: entryPoint.rotationId,
				isFallback: entryPoint.isFallback,
				createdAt: entryPoint.createdAt,
				rotationName: rotationWithAssignee.name,
				effectiveAssignee: rotationWithAssignee.effectiveAssignee,
			})
			.from(entryPoint)
			.leftJoin(rotationWithAssignee, eq(entryPoint.rotationId, rotationWithAssignee.id))
			.where(eq(entryPoint.clientId, context.clientId))
			.orderBy(desc(entryPoint.createdAt));

		return entryPointsWithRotation.map((ep) => {
			if (ep.type === "slack-user") {
				return {
					id: ep.id,
					type: ep.type as "slack-user",
					prompt: ep.prompt,
					assigneeId: ep.assigneeId!,
					isFallback: ep.isFallback,
				};
			} else if (ep.type === "rotation") {
				return {
					id: ep.id,
					type: ep.type,
					prompt: ep.prompt,
					rotationId: ep.rotationId,
					isFallback: ep.isFallback,
					name: ep.rotationName,
					assigneeId: ep.effectiveAssignee,
				};
			} else {
				throw new Error("Invalid entry point type");
			}
		});
	});

export const getSlackUsers = createServerFn({
	method: "GET",
})
	.middleware([authMiddleware])
	.handler(async ({ context }) => {
		const [slackIntegration] = await db.select().from(integration).where(eq(integration.clientId, context.clientId)).limit(1);
		const slackIntegrationData = slackIntegration?.data;
		if (!slackIntegrationData) {
			return [];
		}
		const slackUsers = await fetchSlackUsers(slackIntegrationData.botToken);
		return slackUsers;
	});

export type CreateEntryPointInput = { type: "slack-user"; assigneeId: string } | { type: "rotation"; rotationId: string };

export const createEntryPoint = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: CreateEntryPointInput) => data)
	.handler(async ({ data, context }) => {
		const existing = await db.select().from(entryPoint).where(eq(entryPoint.clientId, context.clientId)).limit(1);
		const isFirst = existing.length === 0;

		const values =
			data.type === "slack-user"
				? {
						clientId: context.clientId,
						type: data.type,
						prompt: "",
						assigneeId: data.assigneeId,
						isFallback: isFirst,
					}
				: {
						clientId: context.clientId,
						type: data.type,
						prompt: "",
						rotationId: data.rotationId,
						isFallback: isFirst,
					};

		const [newEntryPoint] = await db.insert(entryPoint).values(values).returning();

		return {
			id: newEntryPoint.id,
			type: newEntryPoint.type,
			prompt: newEntryPoint.prompt,
			assigneeId: newEntryPoint.assigneeId,
			rotationId: newEntryPoint.rotationId,
			isFallback: newEntryPoint.isFallback,
		};
	});

export const deleteEntryPoint = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { id: string }) => data)
	.handler(async ({ data, context }) => {
		await db.transaction(async (tx) => {
			const result = await tx
				.delete(entryPoint)
				.where(and(eq(entryPoint.id, data.id), eq(entryPoint.clientId, context.clientId)))
				.returning();

			if (result.length === 0) {
				throw new Error("Entry point not found");
			}

			const deletedEntryPoint = result[0];

			if (deletedEntryPoint.isFallback) {
				const remaining = await tx.select().from(entryPoint).where(eq(entryPoint.clientId, context.clientId));

				if (remaining.length > 0) {
					const randomIndex = Math.floor(Math.random() * remaining.length);
					const newFallback = remaining[randomIndex];

					await tx.update(entryPoint).set({ isFallback: true }).where(eq(entryPoint.id, newFallback.id));
				}
			}
		});

		return { success: true };
	});

export const updateEntryPointPrompt = createServerFn({ method: "POST" })
	.inputValidator((data: { id: string; prompt: string }) => data)
	.middleware([authMiddleware])
	.handler(async ({ data, context }) => {
		const [updated] = await db
			.update(entryPoint)
			.set({ prompt: data.prompt })
			.where(and(eq(entryPoint.id, data.id), eq(entryPoint.clientId, context.clientId)))
			.returning();

		if (!updated) {
			throw new Error("Entry point not found");
		}

		return {
			id: updated.id,
			type: updated.type,
			prompt: updated.prompt,
			assigneeId: updated.assigneeId,
			rotationId: updated.rotationId,
			isFallback: updated.isFallback,
		};
	});

export const setFallbackEntryPoint = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { id: string }) => data)
	.handler(async ({ data, context }) => {
		await db.transaction(async (tx) => {
			await tx
				.update(entryPoint)
				.set({ isFallback: false })
				.where(and(eq(entryPoint.clientId, context.clientId), eq(entryPoint.isFallback, true)));

			const [updated] = await tx
				.update(entryPoint)
				.set({ isFallback: true })
				.where(and(eq(entryPoint.id, data.id), eq(entryPoint.clientId, context.clientId)))
				.returning();

			if (!updated) {
				throw new Error("Entry point not found");
			}
		});

		return { success: true };
	});
