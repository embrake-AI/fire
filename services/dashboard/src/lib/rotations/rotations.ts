import { emailInDomains, type SHIFT_LENGTH_OPTIONS } from "@fire/common";
import { getAddAssigneeSQL, getMoveAssigneeSQL, getRemoveAssigneeSQL } from "@fire/db/rotation-helpers";
import { client, entryPoint, integration, rotation, rotationOverride, rotationWithAssignee, user } from "@fire/db/schema";
import { createServerFn } from "@tanstack/solid-start";
import { and, desc, eq, exists, gt, inArray, lt, lte, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { start } from "workflow/api";
import { rotationActionWorkflow, type ScheduleAction } from "../../workflows/rotation/action";
import { rotationScheduleWorkflow } from "../../workflows/rotation/schedule";
import { authMiddleware } from "../auth/auth-middleware";
import { uploadImageFromUrl } from "../blob";
import { db } from "../db";
import { fetchSlackUserById } from "../slack";

export type { SlackUser } from "../slack";

async function performRotationAction(rotationId: string, action: ScheduleAction): Promise<{ id?: string }> {
	const run = await start(rotationActionWorkflow, [{ rotationId, action }]);
	const result = await run.returnValue;
	if (!result.success) {
		throw new Error(result.error);
	}
	return { id: result.id };
}

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
				shiftStart: rotationWithAssignee.shiftStart,
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

		const rotationIds = rotations.map((rotation) => rotation.id);
		const now = new Date();
		const overridesByRotation = new Map<string, string>();

		const currentOverrides = await db
			.select({
				id: rotationOverride.id,
				rotationId: rotationOverride.rotationId,
				createdAt: rotationOverride.createdAt,
			})
			.from(rotationOverride)
			.where(and(inArray(rotationOverride.rotationId, rotationIds), lte(rotationOverride.startAt, now), gt(rotationOverride.endAt, now)))
			.orderBy(desc(rotationOverride.createdAt), desc(rotationOverride.id));

		for (const override of currentOverrides) {
			if (!overridesByRotation.has(override.rotationId)) {
				overridesByRotation.set(override.rotationId, override.id);
			}
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
				shiftStart: r.shiftStart,
				shiftLength: r.shiftLength,
				assignees: reorderedAssignees,
				createdAt: r.createdAt,
				isInUse: r.isInUse,
				currentAssignee: r.effectiveAssignee,
				currentOverrideId: overridesByRotation.get(r.id) ?? null,
				teamId: r.teamId,
			};
		});
	});

type ShiftLength = (typeof SHIFT_LENGTH_OPTIONS)[number]["value"];

export const createRotation = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { name: string; shiftLength: ShiftLength; anchorAt?: Date; teamId?: string }) => data)
	.handler(async ({ data, context }) => {
		let anchorAt = data.anchorAt;
		if (!anchorAt) {
			if (data.shiftLength === "1 day") {
				anchorAt = new Date(new Date().setHours(0, 0, 0, 0));
			} else if (data.shiftLength === "1 week" || data.shiftLength === "2 weeks") {
				anchorAt = new Date(new Date(new Date().setDate(new Date().getDate() - new Date().getDay())).setHours(0, 0, 0, 0));
			} else {
				throw new Error("Invalid shift length");
			}
		}

		const rotationId = crypto.randomUUID();

		// Start schedule workflow - it will create the DB record and manage transitions
		await start(rotationScheduleWorkflow, [
			{
				rotationId,
				clientId: context.clientId,
				name: data.name,
				anchorAt,
				shiftLength: data.shiftLength,
				teamId: data.teamId,
			},
		]);

		return {
			id: rotationId,
			name: data.name,
			anchorAt,
			shiftLength: data.shiftLength,
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

		// Verify rotation exists and belongs to client
		const [existingRotation] = await db
			.select()
			.from(rotation)
			.where(and(eq(rotation.id, data.id), eq(rotation.clientId, context.clientId)));

		if (!existingRotation) {
			throw new Error("Rotation not found");
		}

		await performRotationAction(data.id, { type: "delete" });

		return { success: true };
	});

export const updateRotationName = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { id: string; name: string }) => data)
	.handler(async ({ data, context }) => {
		// Verify rotation exists and belongs to client
		const [existingRotation] = await db
			.select()
			.from(rotation)
			.where(and(eq(rotation.id, data.id), eq(rotation.clientId, context.clientId)));

		if (!existingRotation) {
			throw new Error("Rotation not found");
		}

		await db.update(rotation).set({ name: data.name }).where(eq(rotation.id, data.id));

		return { id: data.id, name: data.name };
	});

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

		await performRotationAction(data.id, { type: "updateShiftLength", shiftLength: data.shiftLength });

		return { id: data.id, shiftLength: data.shiftLength };
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

		await db.execute(getAddAssigneeSQL(data.rotationId, data.assigneeId));

		return { success: true };
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

			// Add assignee within the same transaction
			await tx.execute(getAddAssigneeSQL(data.rotationId, userId));
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

		await db.transaction(async (tx) => {
			await tx.execute(sql`set constraints "rotation_member_rotation_position_idx" deferred`);
			await tx.execute(getMoveAssigneeSQL(data.rotationId, data.assigneeId, data.newPosition));
		});

		return { success: true };
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

		await db.transaction(async (tx) => {
			await tx.execute(sql`set constraints "rotation_member_rotation_position_idx" deferred`);
			await tx.execute(getRemoveAssigneeSQL(data.rotationId, data.assigneeId, true));
		});

		return { success: true };
	});

export const getRotationOverrides = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { rotationId: string; startAt: Date; endAt: Date }) => data)
	.handler(async ({ data, context }) => {
		if (data.startAt >= data.endAt) {
			throw new Error("Invalid override range");
		}

		const [existingRotation] = await db
			.select()
			.from(rotation)
			.where(and(eq(rotation.id, data.rotationId), eq(rotation.clientId, context.clientId)));

		if (!existingRotation) {
			throw new Error("Rotation not found");
		}

		const overrides = await db
			.select({
				id: rotationOverride.id,
				assigneeId: rotationOverride.assigneeId,
				startAt: rotationOverride.startAt,
				endAt: rotationOverride.endAt,
				createdAt: rotationOverride.createdAt,
			})
			.from(rotationOverride)
			.where(and(eq(rotationOverride.rotationId, data.rotationId), lt(rotationOverride.startAt, data.endAt), gt(rotationOverride.endAt, data.startAt)))
			.orderBy(rotationOverride.startAt);

		return overrides;
	});

export const createRotationOverride = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { rotationId: string; assigneeId: string; startAt: Date; endAt: Date }) => data)
	.handler(async ({ data, context }) => {
		if (data.startAt >= data.endAt) {
			throw new Error("Invalid override range");
		}

		const [existingRotation] = await db
			.select()
			.from(rotation)
			.where(and(eq(rotation.id, data.rotationId), eq(rotation.clientId, context.clientId)));

		if (!existingRotation) {
			throw new Error("Rotation not found");
		}

		const result = await performRotationAction(data.rotationId, {
			type: "createOverride",
			assigneeId: data.assigneeId,
			startAt: data.startAt,
			endAt: data.endAt,
		});

		return { success: true, id: result.id };
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

		await performRotationAction(data.rotationId, { type: "setOverride", assigneeId: data.assigneeId });

		return { success: true };
	});

export const clearRotationOverride = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { rotationId: string; overrideId: string }) => data)
	.handler(async ({ data, context }) => {
		const [existingRotation] = await db
			.select()
			.from(rotation)
			.where(and(eq(rotation.id, data.rotationId), eq(rotation.clientId, context.clientId)));

		if (!existingRotation) {
			throw new Error("Rotation not found");
		}

		await performRotationAction(data.rotationId, { type: "clearOverride", overrideId: data.overrideId });

		return { success: true };
	});

export const updateRotationOverride = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { rotationId: string; overrideId: string; assigneeId: string; startAt: Date; endAt: Date }) => data)
	.handler(async ({ data, context }) => {
		if (data.startAt >= data.endAt) {
			throw new Error("Invalid override range");
		}

		const [existingRotation] = await db
			.select()
			.from(rotation)
			.where(and(eq(rotation.id, data.rotationId), eq(rotation.clientId, context.clientId)));

		if (!existingRotation) {
			throw new Error("Rotation not found");
		}

		await performRotationAction(data.rotationId, {
			type: "updateOverride",
			overrideId: data.overrideId,
			assigneeId: data.assigneeId,
			startAt: data.startAt,
			endAt: data.endAt,
		});

		return { success: true };
	});

export const updateRotationAnchor = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { id: string; anchorAt: Date }) => data)
	.handler(async ({ data, context }) => {
		const [existingRotation] = await db
			.select()
			.from(rotation)
			.where(and(eq(rotation.id, data.id), eq(rotation.clientId, context.clientId)));
		if (!existingRotation) {
			throw new Error("Rotation not found");
		}

		await performRotationAction(data.id, { type: "updateAnchor", anchorAt: data.anchorAt });

		return { id: data.id, anchorAt: data.anchorAt };
	});
