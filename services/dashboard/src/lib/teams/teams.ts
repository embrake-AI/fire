import { emailInDomains } from "@fire/common";
import type { SlackIntegrationData } from "@fire/db/schema";
import { client, integration, team, teamMember, user } from "@fire/db/schema";
import { createServerFn } from "@tanstack/solid-start";
import { and, count, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { authMiddleware } from "../auth/auth-middleware";
import { uploadImageFromUrl } from "../blob";
import { db } from "../db";
import { fetchSlackUserById } from "../slack";

export const getTeams = createServerFn({
	method: "GET",
})
	.middleware([authMiddleware])
	.handler(async ({ context }) => {
		const teamsWithMemberCount = await db
			.select({
				id: team.id,
				name: team.name,
				imageUrl: team.imageUrl,
				createdAt: team.createdAt,
				memberCount: count(teamMember.userId),
			})
			.from(team)
			.leftJoin(teamMember, eq(team.id, teamMember.teamId))
			.where(eq(team.clientId, context.clientId))
			.groupBy(team.id);

		return teamsWithMemberCount;
	});

export const createTeam = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { name: string }) => data)
	.handler(async ({ data, context }) => {
		const [newTeam] = await db
			.insert(team)
			.values({
				name: data.name,
				clientId: context.clientId,
			})
			.returning();

		return {
			id: newTeam.id,
			name: newTeam.name,
			imageUrl: newTeam.imageUrl,
			createdAt: newTeam.createdAt,
			memberCount: 0,
		};
	});

export const deleteTeam = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { id: string }) => data)
	.handler(async ({ data, context }) => {
		const result = await db
			.delete(team)
			.where(and(eq(team.id, data.id), eq(team.clientId, context.clientId)))
			.returning();

		if (result.length === 0) {
			throw new Error("Team not found");
		}

		return { success: true };
	});

export const addTeamMember = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { teamId: string; userId: string }) => data)
	.handler(async ({ data, context }) => {
		const [existingTeam] = await db
			.select()
			.from(team)
			.where(and(eq(team.id, data.teamId), eq(team.clientId, context.clientId)));

		if (!existingTeam) {
			throw new Error("Team not found");
		}

		await db
			.insert(teamMember)
			.values({
				teamId: data.teamId,
				userId: data.userId,
			})
			.onConflictDoNothing();

		return { success: true };
	});

export const removeTeamMember = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { teamId: string; userId: string }) => data)
	.handler(async ({ data, context }) => {
		const [existingTeam] = await db
			.select()
			.from(team)
			.where(and(eq(team.id, data.teamId), eq(team.clientId, context.clientId)));

		if (!existingTeam) {
			throw new Error("Team not found");
		}

		await db.delete(teamMember).where(and(eq(teamMember.teamId, data.teamId), eq(teamMember.userId, data.userId)));

		return { success: true };
	});

export const updateTeam = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { id: string; name?: string; imageUrl?: string | null }) => data)
	.handler(async ({ data, context }) => {
		const updateFields: { name?: string; imageUrl?: string | null } = {};
		if (data.name !== undefined) {
			updateFields.name = data.name;
		}
		if (data.imageUrl) {
			updateFields.imageUrl = data.imageUrl || null;
		}

		const [updatedTeam] = await db
			.update(team)
			.set(updateFields)
			.where(and(eq(team.id, data.id), eq(team.clientId, context.clientId)))
			.returning();

		if (!updatedTeam) {
			throw new Error("Team not found");
		}

		return {
			id: updatedTeam.id,
			name: updatedTeam.name,
			imageUrl: updatedTeam.imageUrl,
		};
	});

export const addSlackUserAsTeamMember = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { teamId: string; slackUserId: string }) => data)
	.handler(async ({ data, context }) => {
		const [existingTeam] = await db
			.select()
			.from(team)
			.where(and(eq(team.id, data.teamId), eq(team.clientId, context.clientId)));

		if (!existingTeam) {
			throw new Error("Team not found");
		}

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

		await db.transaction(async (tx) => {
			if (existingUser) {
				if (existingUser.slackId && existingUser.slackId !== data.slackUserId) {
					throw new Error("User linked to a different Slack user");
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

			await tx
				.insert(teamMember)
				.values({
					teamId: data.teamId,
					userId,
				})
				.onConflictDoNothing();
		});

		return { success: true, userId };
	});
