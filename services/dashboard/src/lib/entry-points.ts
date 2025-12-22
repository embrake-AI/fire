import { entryPoint, integration } from "@fire/db";
import { createServerFn } from "@tanstack/solid-start";
import { desc, eq } from "drizzle-orm";
import { authMiddleware } from "./auth-middleware";
import { db } from "./db";
import { fetchSlackUserGroups, fetchSlackUsers } from "./slack";

export type { SlackUser, SlackUserGroup } from "./slack";

export type EntryPoint = {
	id: string;
	prompt: string;
	type: "slack-user" | "slack-user-group";
	assigneeId: string;
};

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

		const entryPoints = await db.select().from(entryPoint).orderBy(desc(entryPoint.createdAt));
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
	.inputValidator((data: { id: string; type: "slack-user" | "slack-user-group" }) => data)
	.handler(async ({ data }) => {
		const [newEntryPoint] = await db
			.insert(entryPoint)
			.values({
				type: data.type,
				prompt: "",
				assigneeId: data.id,
			})
			.returning();

		return {
			id: newEntryPoint.id,
			type: newEntryPoint.type,
			prompt: newEntryPoint.prompt,
			assigneeId: newEntryPoint.assigneeId,
		};
	});

export const deleteEntryPoint = createServerFn({ method: "POST" })
	.inputValidator((data: { id: string }) => data)
	.handler(async ({ data }) => {
		const result = await db.delete(entryPoint).where(eq(entryPoint.id, data.id)).returning();

		if (result.length === 0) {
			throw new Error("Entry point not found");
		}

		return { success: true };
	});

export const updateEntryPointPrompt = createServerFn({ method: "POST" })
	.inputValidator((data: { id: string; prompt: string }) => data)
	.handler(async ({ data }) => {
		const [updated] = await db.update(entryPoint).set({ prompt: data.prompt }).where(eq(entryPoint.id, data.id)).returning();

		if (!updated) {
			throw new Error("Entry point not found");
		}

		return {
			id: updated.id,
			type: updated.type,
			prompt: updated.prompt,
			externalId: updated.assigneeId,
		};
	});
