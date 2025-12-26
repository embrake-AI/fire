import { entryPoint, integration } from "@fire/db/schema";
import { createServerFn } from "@tanstack/solid-start";
import { and, desc, eq } from "drizzle-orm";
import { authMiddleware } from "./auth-middleware";
import { db } from "./db";
import { fetchSlackUserGroups, fetchSlackUsers } from "./slack";

export type { SlackUser, SlackUserGroup } from "./slack";

export const getEntryPoints = createServerFn({
	method: "GET",
})
	.middleware([authMiddleware])
	.handler(async ({ context }) => {
		const [slackIntegration] = await db.select().from(integration).where(eq(integration.clientId, context.clientId)).limit(1);
		const slackIntegrationData = slackIntegration?.data;
		if (!slackIntegrationData) {
			return [];
		}

		const botToken = slackIntegrationData.botToken;
		const [slackUsers, slackUserGroups] = await Promise.all([fetchSlackUsers(botToken), fetchSlackUserGroups(botToken)]);

		const entryPoints = await db.select().from(entryPoint).where(eq(entryPoint.clientId, context.clientId)).orderBy(desc(entryPoint.createdAt));

		return entryPoints.map((ep) => {
			if (ep.type === "slack-user") {
				const slackUser = slackUsers.find((u) => u.id === ep.assigneeId);
				if (!slackUser) {
					// TODO: Handle this better when someone complains
					throw new Error("Slack user not found");
				}
				return {
					id: ep.id,
					type: ep.type,
					prompt: ep.prompt,
					assigneeId: ep.assigneeId,
					isFallback: ep.isFallback,
					name: slackUser.name,
					avatar: slackUser.avatar,
				};
			} else if (ep.type === "slack-user-group") {
				const slackUserGroup = slackUserGroups.find((g) => g.id === ep.assigneeId);
				if (!slackUserGroup) {
					// TODO: Handle this better when someone complains
					throw new Error("Slack user group not found");
				}
				return {
					id: ep.id,
					type: ep.type,
					prompt: ep.prompt,
					assigneeId: ep.assigneeId,
					isFallback: ep.isFallback,
					name: slackUserGroup.handle,
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

export const getSlackUserGroups = createServerFn({
	method: "GET",
})
	.middleware([authMiddleware])
	.handler(async ({ context }) => {
		const [slackIntegration] = await db.select().from(integration).where(eq(integration.clientId, context.clientId)).limit(1);
		const slackIntegrationData = slackIntegration?.data;
		if (!slackIntegrationData) {
			return [];
		}
		const slackUserGroups = await fetchSlackUserGroups(slackIntegrationData.botToken);
		return slackUserGroups;
	});

export const createEntryPoint = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { id: string; type: "slack-user" | "slack-user-group" }) => data)
	.handler(async ({ data, context }) => {
		const existing = await db.select().from(entryPoint).where(eq(entryPoint.clientId, context.clientId)).limit(1);
		const isFirst = existing.length === 0;

		const [newEntryPoint] = await db
			.insert(entryPoint)
			.values({
				clientId: context.clientId,
				type: data.type,
				prompt: "",
				assigneeId: data.id,
				isFallback: isFirst,
			})
			.returning();

		return {
			id: newEntryPoint.id,
			type: newEntryPoint.type,
			prompt: newEntryPoint.prompt,
			assigneeId: newEntryPoint.assigneeId,
			isFallback: newEntryPoint.isFallback,
		};
	});

export const deleteEntryPoint = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { id: string }) => data)
	.handler(async ({ data, context }) => {
		const result = await db
			.delete(entryPoint)
			.where(and(eq(entryPoint.id, data.id), eq(entryPoint.clientId, context.clientId)))
			.returning();

		if (result.length === 0) {
			throw new Error("Entry point not found");
		}

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
			externalId: updated.assigneeId,
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
