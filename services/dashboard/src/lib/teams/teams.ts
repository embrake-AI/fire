import { team, teamMember } from "@fire/db/schema";
import { createServerFn } from "@tanstack/solid-start";
import { and, count, eq } from "drizzle-orm";
import { authMiddleware } from "../auth/auth-middleware";
import { db } from "../db";

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
	.inputValidator((data: { id: string; name?: string; imageUrl?: string }) => data)
	.handler(async ({ data, context }) => {
		const [updatedTeam] = await db
			.update(team)
			.set({
				name: data.name,
				imageUrl: data.imageUrl,
			})
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

export const getUsers = createServerFn({
	method: "GET",
})
	.middleware([authMiddleware])
	.handler(async ({ context }) => {
		const users = await db.query.user.findMany({
			where: {
				clientId: context.clientId,
			},
			with: {
				teams: {
					columns: {
						id: true,
					},
				},
			},
		});

		return users.map((user) => ({
			id: user.id,
			name: user.name,
			email: user.email,
			image: user.image,
			teamIds: user.teams.map((team) => team.id),
		}));
	});
