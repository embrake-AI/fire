import { emailInDomains, type SHIFT_LENGTH_OPTIONS } from "@fire/common";
import { getAddAssigneeSQL, getMoveAssigneeSQL, getRemoveAssigneeSQL, getSetOverrideSQL, getUpdateAnchorSQL, getUpdateIntervalSQL } from "@fire/db/rotation-helpers";
import type { SlackIntegrationData } from "@fire/db/schema";
import { client, entryPoint, integration, rotation, rotationOverride, rotationWithAssignee, user } from "@fire/db/schema";
import { createServerFn } from "@tanstack/solid-start";
import { and, desc, eq, exists, gt, inArray, lt, lte, type SQL, sql } from "drizzle-orm";
import { resumeHook, start } from "workflow/api";
import { getRotationScheduleWakeToken, type RotationScheduleWakeAction, rotationScheduleWorkflow } from "~/workflows/rotation/schedule";
import { authMiddleware } from "../auth/auth-middleware";
import { isWorkspaceCatalogWriter, requirePermission } from "../auth/authorization";
import { assertTeamAdminOrWorkspaceCatalogWriter } from "../auth/authorization.server";
import { queueBillingSeatSync } from "../billing/billing.server";
import { uploadImageFromUrl } from "../blob";
import { db } from "../db";
import { createUserFacingError } from "../errors/user-facing-error";
import { fetchSlackSelectableChannels, fetchSlackUserById, joinSlackChannel } from "../slack";
import { createWorkspaceUser } from "../users/users.server";

export type { SlackUser } from "../slack";

async function startRotationScheduleWorkflow(rotationId: string): Promise<void> {
	await start(rotationScheduleWorkflow, [{ rotationId }]);
}

async function notifyRotationScheduleWorkflow(rotationId: string, signal: { deleted?: boolean; action?: RotationScheduleWakeAction }): Promise<void> {
	try {
		await resumeHook(getRotationScheduleWakeToken(rotationId), signal);
	} catch (error) {
		console.error("Failed to notify rotation schedule workflow", {
			rotationId,
			signal,
			error,
		});
	}
}

type RotationWriteContext = {
	role?: Parameters<typeof isWorkspaceCatalogWriter>[0];
	clientId: string;
	userId: string;
};

async function getRotationForWrite(rotationId: string, clientId: string) {
	const [existingRotation] = await db
		.select({
			id: rotation.id,
			teamId: rotation.teamId,
			clientId: rotation.clientId,
		})
		.from(rotation)
		.where(and(eq(rotation.id, rotationId), eq(rotation.clientId, clientId)))
		.limit(1);

	if (!existingRotation) {
		throw createUserFacingError("Rotation not found.");
	}

	return existingRotation;
}

async function assertRotationWriteAccess(context: RotationWriteContext, rotationId: string) {
	const existingRotation = await getRotationForWrite(rotationId, context.clientId);
	await assertTeamAdminOrWorkspaceCatalogWriter(context, existingRotation.teamId);
	return existingRotation;
}

export const getRotations = createServerFn({
	method: "GET",
})
	.middleware([authMiddleware, requirePermission("catalog.read")])
	.handler(async ({ context }) => {
		const isInUseSubquery = exists(db.select().from(entryPoint).where(eq(entryPoint.rotationId, rotationWithAssignee.id))).mapWith(Boolean);

		const rotations = await db
			.select({
				id: rotationWithAssignee.id,
				name: rotationWithAssignee.name,
				slackChannelId: rotationWithAssignee.slackChannelId,
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
				slackChannelId: r.slackChannelId,
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

export const getRotationSelectableSlackChannels = createServerFn({ method: "GET" })
	.middleware([authMiddleware, requirePermission("catalog.read")])
	.handler(async ({ context }) => {
		const [slackIntegration] = await db
			.select({ data: integration.data })
			.from(integration)
			.where(and(eq(integration.clientId, context.clientId), eq(integration.platform, "slack")))
			.limit(1);

		if (!slackIntegration?.data) {
			return [];
		}

		const slackData = slackIntegration.data as SlackIntegrationData;
		if (!slackData.botToken) {
			return [];
		}

		return fetchSlackSelectableChannels(slackData.botToken);
	});

type ShiftLength = (typeof SHIFT_LENGTH_OPTIONS)[number]["value"];

export const createRotation = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { name: string; shiftLength: ShiftLength; anchorAt?: Date; teamId?: string }) => data)
	.handler(async ({ data, context }) => {
		if (!isWorkspaceCatalogWriter(context.role)) {
			await assertTeamAdminOrWorkspaceCatalogWriter(context, data.teamId);
		}

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

		const [newRotation] = await db
			.insert(rotation)
			.values({
				clientId: context.clientId,
				name: data.name,
				shiftLength: data.shiftLength,
				anchorAt,
				teamId: data.teamId,
			})
			.returning();

		try {
			await startRotationScheduleWorkflow(newRotation.id);
		} catch (_error) {
			await db.delete(rotation).where(and(eq(rotation.id, newRotation.id), eq(rotation.clientId, context.clientId)));
			throw new Error("Failed to start rotation schedule workflow");
		}

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
		await assertRotationWriteAccess(context, data.id);

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

		await notifyRotationScheduleWorkflow(data.id, { deleted: true });
		queueBillingSeatSync(context.clientId);

		return { success: true };
	});

export const updateRotationName = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { id: string; name: string }) => data)
	.handler(async ({ data, context }) => {
		await assertRotationWriteAccess(context, data.id);

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

export const updateRotationTeam = createServerFn({ method: "POST" })
	.middleware([authMiddleware, requirePermission("catalog.write")])
	.inputValidator((data: { id: string; teamId: string | null }) => data)
	.handler(async ({ data, context }) => {
		const existingRotation = await db.query.rotation.findFirst({
			where: {
				id: data.id,
				clientId: context.clientId,
			},
			with: {
				members: {
					columns: {
						assigneeId: true,
					},
				},
			},
		});

		if (!existingRotation) {
			throw new Error("Rotation not found");
		}

		if (data.teamId) {
			const existingTeam = await db.query.team.findFirst({
				where: {
					id: data.teamId,
					clientId: context.clientId,
				},
				with: {
					members: {
						columns: {
							id: true,
						},
					},
				},
			});

			if (!existingTeam) {
				throw new Error("Team not found");
			}

			const assignees = existingRotation.members.map(({ assigneeId }) => assigneeId);
			if (assignees.length > 0) {
				const memberIds = new Set(existingTeam.members.map(({ id }) => id));
				const missingMember = assignees.find((assigneeId) => !memberIds.has(assigneeId));
				if (missingMember) {
					throw new Error("All rotation members must belong to the selected team");
				}
			}
		}

		const [updated] = await db
			.update(rotation)
			.set({ teamId: data.teamId })
			.where(and(eq(rotation.id, data.id), eq(rotation.clientId, context.clientId)))
			.returning({ id: rotation.id, teamId: rotation.teamId });

		if (!updated) {
			throw new Error("Rotation not found");
		}

		return { id: updated.id, teamId: updated.teamId };
	});

export const updateRotationSlackChannel = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { id: string; slackChannelId: string | null }) => data)
	.handler(async ({ data, context }) => {
		await assertRotationWriteAccess(context, data.id);

		if (data.slackChannelId) {
			const [slackIntegration] = await db
				.select({ data: integration.data })
				.from(integration)
				.where(and(eq(integration.clientId, context.clientId), eq(integration.platform, "slack")))
				.limit(1);

			if (!slackIntegration?.data) {
				throw createUserFacingError("Slack isn't connected to this workspace.");
			}

			const slackData = slackIntegration.data as SlackIntegrationData;
			let channels: Awaited<ReturnType<typeof fetchSlackSelectableChannels>>;
			try {
				channels = await fetchSlackSelectableChannels(slackData.botToken);
			} catch {
				throw createUserFacingError("We couldn't load Slack channels right now. Please try again.");
			}
			const selectedChannel = channels.find((channel) => channel.id === data.slackChannelId);

			if (!selectedChannel) {
				throw createUserFacingError("The selected Slack channel isn't available.");
			}

			if (!selectedChannel.isMember) {
				if (selectedChannel.isPrivate) {
					throw createUserFacingError("Invite the Fire bot to that private channel before selecting it.");
				}
				try {
					await joinSlackChannel(slackData.botToken, selectedChannel.id);
				} catch {
					throw createUserFacingError("Couldn't join that Slack channel automatically. Please invite the Fire bot and try again.");
				}
			}
		}

		const [updated] = await db
			.update(rotation)
			.set({ slackChannelId: data.slackChannelId })
			.where(and(eq(rotation.id, data.id), eq(rotation.clientId, context.clientId)))
			.returning({ id: rotation.id, slackChannelId: rotation.slackChannelId });

		if (!updated) {
			throw new Error("Rotation not found");
		}

		await notifyRotationScheduleWorkflow(data.id, { action: "update_slack_channel" });

		return { id: updated.id, slackChannelId: updated.slackChannelId };
	});

type InferFromSQL<T> = T extends SQL<infer R> ? R : never;
export const updateRotationShiftLength = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { id: string; shiftLength: string }) => data)
	.handler(async ({ data, context }) => {
		await assertRotationWriteAccess(context, data.id);

		const { rows } = await db.execute<InferFromSQL<ReturnType<typeof getUpdateIntervalSQL>>>(getUpdateIntervalSQL(data.id, data.shiftLength));
		const result = rows[0];
		if (!result) {
			throw new Error("Failed to update rotation");
		}

		await notifyRotationScheduleWorkflow(data.id, { action: "update_shift_length" });

		return { id: result.id, shiftLength: result.shiftLength };
	});

export const addRotationAssignee = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { rotationId: string; assigneeId: string }) => data)
	.handler(async ({ data, context }) => {
		await assertRotationWriteAccess(context, data.rotationId);

		await db.execute(getAddAssigneeSQL(data.rotationId, data.assigneeId));

		await notifyRotationScheduleWorkflow(data.rotationId, { action: "add_assignee" });
		queueBillingSeatSync(context.clientId);

		return { success: true };
	});

export const addSlackUserAsRotationAssignee = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { rotationId: string; slackUserId: string }) => data)
	.handler(async ({ data, context }) => {
		await assertRotationWriteAccess(context, data.rotationId);

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

				const createdUser = await createWorkspaceUser(tx, {
					name: slackUser.name,
					email: slackUser.email,
					emailVerified: true,
					image: imageUrl,
					clientId: context.clientId,
					slackId: data.slackUserId,
				});
				userId = createdUser.id;
			}

			await tx.execute(getAddAssigneeSQL(data.rotationId, userId));
		});

		await notifyRotationScheduleWorkflow(data.rotationId, { action: "add_assignee" });
		queueBillingSeatSync(context.clientId);

		return { success: true, userId };
	});

export const reorderRotationAssignee = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { rotationId: string; assigneeId: string; newPosition: number }) => data)
	.handler(async ({ data, context }) => {
		await assertRotationWriteAccess(context, data.rotationId);

		await db.transaction(async (tx) => {
			await tx.execute(sql`set constraints "rotation_member_rotation_position_idx" deferred`);
			await tx.execute(getMoveAssigneeSQL(data.rotationId, data.assigneeId, data.newPosition));
		});

		await notifyRotationScheduleWorkflow(data.rotationId, { action: "reorder_assignee" });

		return { success: true };
	});

export const removeRotationAssignee = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { rotationId: string; assigneeId: string }) => data)
	.handler(async ({ data, context }) => {
		await assertRotationWriteAccess(context, data.rotationId);

		await db.transaction(async (tx) => {
			await tx.execute(sql`set constraints "rotation_member_rotation_position_idx" deferred`);
			await tx.execute(getRemoveAssigneeSQL(data.rotationId, data.assigneeId, true));
		});

		await notifyRotationScheduleWorkflow(data.rotationId, { action: "remove_assignee" });
		queueBillingSeatSync(context.clientId);

		return { success: true };
	});

export const getRotationOverrides = createServerFn({ method: "POST" })
	.middleware([authMiddleware, requirePermission("catalog.read")])
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

		await assertRotationWriteAccess(context, data.rotationId);

		const [createdOverride] = await db
			.insert(rotationOverride)
			.values({
				rotationId: data.rotationId,
				assigneeId: data.assigneeId,
				startAt: data.startAt,
				endAt: data.endAt,
			})
			.returning({ id: rotationOverride.id });

		await notifyRotationScheduleWorkflow(data.rotationId, { action: "create_override" });

		return { id: createdOverride?.id };
	});

export const setRotationOverride = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { rotationId: string; assigneeId: string }) => data)
	.handler(async ({ data, context }) => {
		await assertRotationWriteAccess(context, data.rotationId);

		await db.execute(getSetOverrideSQL(data.rotationId, data.assigneeId));
		await notifyRotationScheduleWorkflow(data.rotationId, { action: "set_override" });

		return { success: true };
	});

export const clearRotationOverride = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { rotationId: string; overrideId: string }) => data)
	.handler(async ({ data, context }) => {
		await assertRotationWriteAccess(context, data.rotationId);

		const deleted = await db
			.delete(rotationOverride)
			.where(and(eq(rotationOverride.id, data.overrideId), eq(rotationOverride.rotationId, data.rotationId)))
			.returning({ id: rotationOverride.id });

		if (deleted.length === 0) {
			throw new Error("Override not found");
		}

		await notifyRotationScheduleWorkflow(data.rotationId, { action: "clear_override" });

		return { success: true };
	});

export const updateRotationOverride = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { rotationId: string; overrideId: string; assigneeId: string; startAt: Date; endAt: Date }) => data)
	.handler(async ({ data, context }) => {
		if (data.startAt >= data.endAt) {
			throw new Error("Invalid override range");
		}

		await assertRotationWriteAccess(context, data.rotationId);

		const updated = await db
			.update(rotationOverride)
			.set({
				assigneeId: data.assigneeId,
				startAt: data.startAt,
				endAt: data.endAt,
			})
			.where(and(eq(rotationOverride.id, data.overrideId), eq(rotationOverride.rotationId, data.rotationId)))
			.returning({ id: rotationOverride.id });

		if (updated.length === 0) {
			throw new Error("Override not found");
		}

		await notifyRotationScheduleWorkflow(data.rotationId, { action: "update_override" });

		return { id: updated[0]?.id };
	});

export const updateRotationAnchor = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { id: string; anchorAt: Date }) => data)
	.handler(async ({ data, context }) => {
		await assertRotationWriteAccess(context, data.id);

		const { rows } = await db.execute<InferFromSQL<ReturnType<typeof getUpdateAnchorSQL>>>(getUpdateAnchorSQL(data.id, data.anchorAt));
		const result = rows[0];
		if (!result) {
			throw new Error("Failed to update rotation anchor");
		}

		await notifyRotationScheduleWorkflow(data.id, { action: "update_anchor" });

		return { id: result.id, anchorAt: result.anchorAt };
	});
