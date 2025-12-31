import { emailInDomains, type SHIFT_LENGTH_OPTIONS } from "@fire/common";
import { getAddAssigneeSQL, getRemoveAssigneeSQL, getSetOverrideSQL, getUpdateIntervalSQL } from "@fire/db/rotation-helpers";
import { client, entryPoint, integration, rotation, rotationWithAssignee, user } from "@fire/db/schema";
import { createServerFn } from "@tanstack/solid-start";
import { and, desc, eq, exists, type SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import { authMiddleware } from "../auth/auth-middleware";
import { uploadImageFromUrl } from "../blob";
import { db } from "../db";
import { fetchSlackUserById } from "../slack";

export type { SlackUser } from "../slack";

export const getRotations = createServerFn({
	method: "GET",
})
	.middleware([authMiddleware])
	.handler(async ({ context }) => {
		const isInUseSubquery = exists(db.select().from(entryPoint).where(eq(entryPoint.rotationId, rotationWithAssignee.id))).mapWith(Boolean);

		const rotations = await db
			.select({
				id: rotationWithAssignee.id,
				name: rotationWithAssignee.name,
				shiftLength: rotationWithAssignee.shiftLength,
				assignees: rotationWithAssignee.assignees,
				effectiveAssignee: rotationWithAssignee.effectiveAssignee,
				baseAssignee: rotationWithAssignee.baseAssignee,
				createdAt: rotationWithAssignee.createdAt,
				isInUse: isInUseSubquery,
				teamId: rotationWithAssignee.teamId,
			})
			.from(rotationWithAssignee)
			.where(eq(rotationWithAssignee.clientId, context.clientId))
			.orderBy(desc(rotationWithAssignee.createdAt));

		if (rotations.length === 0) {
			return [];
		}

		return rotations.map((r) => {
			let baseAssigneeIndex = 0;
			const assigneesWithFlags = r.assignees.map((assigneeId, index) => {
				const isBaseAssignee = assigneeId === r.baseAssignee;
				const isOverride = r.effectiveAssignee !== r.baseAssignee && assigneeId === r.effectiveAssignee;
				if (isBaseAssignee) {
					baseAssigneeIndex = index;
				}
				return {
					id: assigneeId,
					isBaseAssignee,
					isOverride,
				};
			});

			const reorderedAssignees = assigneesWithFlags.slice(baseAssigneeIndex).concat(assigneesWithFlags.slice(0, baseAssigneeIndex));

			return {
				id: r.id,
				name: r.name,
				shiftLength: r.shiftLength,
				assignees: reorderedAssignees,
				createdAt: r.createdAt,
				isInUse: r.isInUse,
				currentAssignee: r.effectiveAssignee,
				teamId: r.teamId,
			};
		});
	});

type ShiftLength = (typeof SHIFT_LENGTH_OPTIONS)[number]["value"];

export const createRotation = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { name: string; shiftLength: ShiftLength; anchorAt?: Date; teamId?: string }) => data)
	.handler(async ({ data, context }) => {
		if (!data.anchorAt) {
			if (data.shiftLength === "1 day") {
				data.anchorAt = new Date(new Date().setHours(0, 0, 0, 0));
			} else if (data.shiftLength === "1 week" || data.shiftLength === "2 weeks") {
				data.anchorAt = new Date(new Date(new Date().setDate(new Date().getDate() - new Date().getDay())).setHours(0, 0, 0, 0));
			} else {
				throw new Error("Invalid shift length");
			}
		}

		const [newRotation] = await db
			.insert(rotation)
			.values({
				clientId: context.clientId,
				name: data.name,
				shiftLength: data.shiftLength,
				anchorAt: data.anchorAt,
				assignees: [],
				teamId: data.teamId,
			})
			.returning();

		return {
			id: newRotation.id,
			name: newRotation.name,
			anchorAt: newRotation.anchorAt,
			shiftLength: newRotation.shiftLength,
		};
	});

export const deleteRotation = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { id: string }) => data)
	.handler(async ({ data, context }) => {
		// Check if rotation is used in any entry point
		const usedInEntryPoints = await db
			.select({ id: entryPoint.id })
			.from(entryPoint)
			.where(and(eq(entryPoint.rotationId, data.id), eq(entryPoint.clientId, context.clientId)))
			.limit(1);

		if (usedInEntryPoints.length > 0) {
			throw new Error("Cannot delete rotation: it is used in an entry point");
		}

		const result = await db
			.delete(rotation)
			.where(and(eq(rotation.id, data.id), eq(rotation.clientId, context.clientId)))
			.returning();

		if (result.length === 0) {
			throw new Error("Rotation not found");
		}

		return { success: true };
	});

export const updateRotationName = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { id: string; name: string }) => data)
	.handler(async ({ data, context }) => {
		const [updated] = await db
			.update(rotation)
			.set({ name: data.name })
			.where(and(eq(rotation.id, data.id), eq(rotation.clientId, context.clientId)))
			.returning();

		if (!updated) {
			throw new Error("Rotation not found");
		}

		return { id: updated.id, name: updated.name };
	});

type InferFromSQL<T> = T extends SQL<infer R> ? R : never;
export const updateRotationShiftLength = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { id: string; shiftLength: string }) => data)
	.handler(async ({ data, context }) => {
		const [existingRotation] = await db
			.select()
			.from(rotation)
			.where(and(eq(rotation.id, data.id), eq(rotation.clientId, context.clientId)));
		if (!existingRotation) {
			throw new Error("Rotation not found");
		}

		const { rows } = await db.execute<InferFromSQL<ReturnType<typeof getUpdateIntervalSQL>>>(getUpdateIntervalSQL(data.id, data.shiftLength));
		const result = rows[0];
		if (!result) {
			throw new Error("Failed to update rotation");
		}

		return { id: result.id, shiftLength: result.shiftLength };
	});

export const addRotationAssignee = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { rotationId: string; assigneeId: string }) => data)
	.handler(async ({ data, context }) => {
		const [existingRotation] = await db
			.select()
			.from(rotation)
			.where(and(eq(rotation.id, data.rotationId), eq(rotation.clientId, context.clientId)));
		if (!existingRotation) {
			throw new Error("Rotation not found");
		}

		const { rows } = await db.execute<InferFromSQL<ReturnType<typeof getAddAssigneeSQL>>>(getAddAssigneeSQL(data.rotationId, data.assigneeId));
		const result = rows[0];

		return { success: true, assignees: result?.assignees ?? [] };
	});

export const addSlackUserAsRotationAssignee = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { rotationId: string; slackUserId: string }) => data)
	.handler(async ({ data, context }) => {
		const [existingRotation] = await db
			.select()
			.from(rotation)
			.where(and(eq(rotation.id, data.rotationId), eq(rotation.clientId, context.clientId)));

		if (!existingRotation) {
			throw new Error("Rotation not found");
		}

		const [clientWithSlackIntegration] = await db
			.select()
			.from(integration)
			.fullJoin(client, eq(integration.clientId, client.id))
			.where(and(eq(integration.clientId, context.clientId), eq(integration.platform, "slack")))
			.limit(1);

		const botToken = clientWithSlackIntegration?.integration?.data?.botToken;
		if (!botToken) {
			throw new Error("Slack integration not found");
		}

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

			await tx.execute<InferFromSQL<ReturnType<typeof getAddAssigneeSQL>>>(getAddAssigneeSQL(data.rotationId, userId));
		});

		return { success: true, userId };
	});

export const reorderRotationAssignee = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { rotationId: string; assigneeId: string; newPosition: number }) => data)
	.handler(async ({ data, context }) => {
		const [existingRotation] = await db
			.select()
			.from(rotation)
			.where(and(eq(rotation.id, data.rotationId), eq(rotation.clientId, context.clientId)));

		if (!existingRotation) {
			throw new Error("Rotation not found");
		}

		const result = await db.transaction(async (tx) => {
			await tx.execute(getRemoveAssigneeSQL(data.rotationId, data.assigneeId, false));
			const { rows } = await tx.execute<InferFromSQL<ReturnType<typeof getAddAssigneeSQL>>>(getAddAssigneeSQL(data.rotationId, data.assigneeId, data.newPosition));
			return rows[0];
		});

		return { success: true, assignees: result?.assignees ?? [] };
	});

export const removeRotationAssignee = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { rotationId: string; assigneeId: string }) => data)
	.handler(async ({ data, context }) => {
		const [existingRotation] = await db
			.select()
			.from(rotation)
			.where(and(eq(rotation.id, data.rotationId), eq(rotation.clientId, context.clientId)));

		if (!existingRotation) {
			throw new Error("Rotation not found");
		}

		const { rows } = await db.execute<InferFromSQL<ReturnType<typeof getRemoveAssigneeSQL>>>(getRemoveAssigneeSQL(data.rotationId, data.assigneeId));
		const result = rows[0];

		return { success: true, assignees: result?.assignees ?? [] };
	});

export const setRotationOverride = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { rotationId: string; assigneeId: string }) => data)
	.handler(async ({ data, context }) => {
		const [existingRotation] = await db
			.select()
			.from(rotation)
			.where(and(eq(rotation.id, data.rotationId), eq(rotation.clientId, context.clientId)));

		if (!existingRotation) {
			throw new Error("Rotation not found");
		}

		const { rows } = await db.execute<InferFromSQL<ReturnType<typeof getSetOverrideSQL>>>(getSetOverrideSQL(data.rotationId, data.assigneeId));
		const result = rows[0];
		if (!result) {
			throw new Error("Failed to set rotation override");
		}

		return { success: true, assigneeOverwrite: "" };
	});

export const clearRotationOverride = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { rotationId: string }) => data)
	.handler(async ({ data, context }) => {
		const [existingRotation] = await db
			.select()
			.from(rotation)
			.where(and(eq(rotation.id, data.rotationId), eq(rotation.clientId, context.clientId)));

		if (!existingRotation) {
			throw new Error("Rotation not found");
		}

		await db
			.update(rotation)
			.set({ assigneeOverwrite: null, overrideForShiftStart: null })
			.where(and(eq(rotation.id, data.rotationId), eq(rotation.clientId, context.clientId)));

		return { success: true };
	});
