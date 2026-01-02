import { user } from "@fire/db/schema";
import { createServerFn } from "@tanstack/solid-start";
import { eq } from "drizzle-orm";
import { authMiddleware } from "../auth/auth-middleware";
import { db } from "../db";

export const getCurrentUser = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(async ({ context }) => {
		const [currentUser] = await db
			.select({
				id: user.id,
				name: user.name,
				email: user.email,
				image: user.image,
			})
			.from(user)
			.where(eq(user.id, context.userId));

		if (!currentUser) {
			throw new Error("User not found");
		}

		return currentUser;
	});

export const updateUser = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { name?: string; image?: string | null }) => data)
	.handler(async ({ context, data }) => {
		const [updated] = await db
			.update(user)
			.set({
				...(!!data.name && { name: data.name }),
				...(!!data.image && { image: data.image }),
				updatedAt: new Date(),
			})
			.where(eq(user.id, context.userId))
			.returning({ id: user.id, name: user.name, image: user.image });

		return updated;
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
			slackId: user.slackId,
		}));
	});
