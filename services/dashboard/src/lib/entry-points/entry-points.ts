import { emailInDomains } from "@fire/common";
import type { SlackIntegrationData } from "@fire/db/schema";
import { client, entryPoint, integration, rotation, user } from "@fire/db/schema";
import { createServerFn } from "@tanstack/solid-start";
import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { authMiddleware } from "../auth/auth-middleware";
import { uploadImageFromUrl } from "../blob";
import { db } from "../db";
import { fetchSlackUserById, fetchSlackUsers } from "../slack";

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
				teamId: rotation.teamId,
			})
			.from(entryPoint)
			.leftJoin(rotation, eq(entryPoint.rotationId, rotation.id))
			.where(eq(entryPoint.clientId, context.clientId))
			.orderBy(desc(entryPoint.createdAt));

		return entryPointsWithRotation.map((ep) => {
			if (ep.type === "user") {
				return {
					id: ep.id,
					type: ep.type as "user",
					prompt: ep.prompt,
					assigneeId: ep.assigneeId!,
					isFallback: ep.isFallback,
					teamId: undefined,
				};
			} else if (ep.type === "rotation") {
				return {
					id: ep.id,
					type: ep.type,
					prompt: ep.prompt,
					rotationId: ep.rotationId,
					isFallback: ep.isFallback,
					teamId: ep.teamId,
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
		const [slackIntegration] = await db
			.select()
			.from(integration)
			.where(and(eq(integration.clientId, context.clientId), eq(integration.platform, "slack")))
			.limit(1);
		if (!slackIntegration?.data) {
			return [];
		}
		const slackIntegrationData = slackIntegration.data as SlackIntegrationData;
		const slackUsers = await fetchSlackUsers(slackIntegrationData.botToken);
		return slackUsers;
	});

export type CreateEntryPointInput = { type: "user"; userId: string; prompt?: string } | { type: "rotation"; rotationId: string; prompt?: string; teamId?: string };
export type CreateSlackUserEntryPointInput = { slackUserId: string; prompt?: string };

export const createEntryPoint = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: CreateEntryPointInput) => data)
	.handler(async ({ data, context }) => {
		const existing = await db.select().from(entryPoint).where(eq(entryPoint.clientId, context.clientId)).limit(1);
		const isFirst = existing.length === 0;

		const values =
			data.type === "user"
				? {
						clientId: context.clientId,
						type: "user" as const,
						prompt: data.prompt || "",
						assigneeId: data.userId,
						isFallback: isFirst,
					}
				: {
						clientId: context.clientId,
						type: "rotation" as const,
						prompt: data.prompt || "",
						rotationId: data.rotationId,
						isFallback: isFirst,
					};

		const [newEntryPoint] = await db.insert(entryPoint).values(values).returning();

		return {
			id: newEntryPoint.id,
			type: newEntryPoint.type,
			prompt: newEntryPoint.prompt,
			assigneeId: data.type === "user" ? newEntryPoint.assigneeId : undefined,
			rotationId: data.type === "rotation" ? newEntryPoint.rotationId : undefined,
			isFallback: newEntryPoint.isFallback,
		};
	});

export const createEntryPointFromSlackUser = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: CreateSlackUserEntryPointInput) => data)
	.handler(async ({ data, context }) => {
		const existing = await db.select().from(entryPoint).where(eq(entryPoint.clientId, context.clientId)).limit(1);
		const isFirst = existing.length === 0;

		const [clientWithSlackIntegration] = await db
			.select()
			.from(integration)
			.fullJoin(client, eq(integration.clientId, client.id))
			.where(and(eq(integration.clientId, context.clientId), eq(integration.platform, "slack")))
			.limit(1);

		if (!clientWithSlackIntegration?.integration?.data) {
			throw new Error("Slack integration not found");
		}
		const slackData = clientWithSlackIntegration.integration.data as SlackIntegrationData;
		const botToken = slackData.botToken;

		const slackUser = await fetchSlackUserById(botToken, data.slackUserId);
		if (!slackUser) {
			throw new Error("Slack user not found");
		}
		if (!slackUser.email) {
			throw new Error("Slack user has no email");
		}

		if (!emailInDomains(slackUser.email, clientWithSlackIntegration?.client?.domains ?? [])) {
			throw new Error("Email domain not allowed");
		}

		const [existingUser] = await db
			.select()
			.from(user)
			.where(and(eq(user.email, slackUser.email), eq(user.clientId, context.clientId)));

		let userId!: string;

		const [newEntryPoint] = await db.transaction(async (tx) => {
			if (existingUser) {
				if (existingUser.slackId && existingUser.slackId !== data.slackUserId) {
					throw new Error(`User linked to a different Slack user. Existing: ${existingUser.slackId}, Creating: ${data.slackUserId}`);
				} else {
					if (!existingUser.slackId) {
						await tx.update(user).set({ slackId: data.slackUserId }).where(eq(user.id, existingUser.id));
					}
					userId = existingUser.id;
				}
			} else {
				let imageUrl: string | null = null;
				if (slackUser.avatar) {
					imageUrl = await uploadImageFromUrl(slackUser.avatar, `users/${context.clientId}`);
				}

				userId = nanoid();
				await tx.insert(user).values({
					id: userId,
					name: slackUser.name,
					email: slackUser.email,
					emailVerified: true,
					image: imageUrl,
					clientId: context.clientId,
					slackId: data.slackUserId,
				});
			}

			return tx
				.insert(entryPoint)
				.values({
					clientId: context.clientId,
					type: "user" as const,
					prompt: data.prompt || "",
					assigneeId: userId,
					isFallback: isFirst,
				})
				.returning();
		});

		if (!newEntryPoint) {
			throw new Error("Failed to create entry point");
		}

		return {
			id: newEntryPoint.id,
			type: "user" as const,
			prompt: newEntryPoint.prompt,
			assigneeId: newEntryPoint.assigneeId,
			rotationId: undefined,
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
