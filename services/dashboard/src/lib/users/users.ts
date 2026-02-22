import { emailInDomains } from "@fire/common";
import type { SlackIntegrationData, userRole } from "@fire/db/schema";
import { apiKey, client, integration, rotationMember, rotationOverride, user } from "@fire/db/schema";
import { createServerFn } from "@tanstack/solid-start";
import { and, eq } from "drizzle-orm";
import { authMiddleware } from "../auth/auth-middleware";
import { requirePermission } from "../auth/authorization";
import { uploadImageFromUrl } from "../blob";
import { db } from "../db";
import { createUserFacingError } from "../errors/user-facing-error";
import { fetchSlackUserById } from "../slack";
import { createWorkspaceUser } from "./users.server";

type UserRole = (typeof userRole.enumValues)[number];
type ManageableUserRole = Exclude<UserRole, "SUPER_ADMIN">;

const MANAGEABLE_ROLES = ["VIEWER", "MEMBER", "ADMIN"] as const;

function isManageableRole(role: unknown): role is ManageableUserRole {
	return typeof role === "string" && MANAGEABLE_ROLES.includes(role as ManageableUserRole);
}

function normalizeRoleForManagement(role: UserRole): ManageableUserRole {
	return role === "SUPER_ADMIN" ? "ADMIN" : role;
}

function isRoleEditableForManagement(role: UserRole): boolean {
	return role === "VIEWER" || role === "MEMBER";
}

export const getCurrentUser = createServerFn({ method: "GET" })
	.middleware([authMiddleware, requirePermission("settings.account.read")])
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
	.middleware([authMiddleware, requirePermission("settings.account.write")])
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
	.middleware([authMiddleware, requirePermission("incident.read")])
	.handler(async ({ context }) => {
		const rows = await db.query.user.findMany({
			where: {
				clientId: context.clientId,
			},
			columns: {
				id: true,
				name: true,
				email: true,
				image: true,
				slackId: true,
			},
			with: {
				teamMember: {
					columns: {
						teamId: true,
						role: true,
					},
				},
			},
		});

		return rows.map((workspaceUser) => ({
			id: workspaceUser.id,
			name: workspaceUser.name,
			email: workspaceUser.email,
			image: workspaceUser.image,
			slackId: workspaceUser.slackId,
			teams: workspaceUser.teamMember.map((membership) => ({
				id: membership.teamId,
				role: membership.role,
			})),
		}));
	});

export const getWorkspaceUsersForManagement = createServerFn({ method: "GET" })
	.middleware([authMiddleware, requirePermission("settings.workspace.write")])
	.handler(async ({ context }) => {
		const users = await db
			.select({
				id: user.id,
				name: user.name,
				email: user.email,
				image: user.image,
				role: user.role,
				slackId: user.slackId,
			})
			.from(user)
			.where(eq(user.clientId, context.clientId));

		return users
			.sort((a, b) => a.name.localeCompare(b.name))
			.map((workspaceUser) => ({
				id: workspaceUser.id,
				name: workspaceUser.name,
				email: workspaceUser.email,
				image: workspaceUser.image,
				slackId: workspaceUser.slackId,
				role: normalizeRoleForManagement(workspaceUser.role),
				isRoleEditable: isRoleEditableForManagement(workspaceUser.role),
			}));
	});

export const updateWorkspaceUserRole = createServerFn({ method: "POST" })
	.middleware([authMiddleware, requirePermission("settings.workspace.write")])
	.inputValidator((data: { userId: string; role: ManageableUserRole }) => data)
	.handler(async ({ context, data }) => {
		if (!isManageableRole(data.role)) {
			throw createUserFacingError("Invalid role selection.");
		}

		const [existingUser] = await db
			.select({
				id: user.id,
				role: user.role,
			})
			.from(user)
			.where(and(eq(user.id, data.userId), eq(user.clientId, context.clientId)))
			.limit(1);

		if (!existingUser) {
			throw createUserFacingError("User not found.");
		}

		if (!isRoleEditableForManagement(existingUser.role)) {
			throw createUserFacingError("You don't have permission to modify this user.");
		}

		const [updated] = await db
			.update(user)
			.set({
				role: data.role,
				updatedAt: new Date(),
			})
			.where(and(eq(user.id, data.userId), eq(user.clientId, context.clientId)))
			.returning({
				id: user.id,
				role: user.role,
			});

		if (!updated) {
			throw createUserFacingError("User not found.");
		}

		return {
			id: updated.id,
			role: normalizeRoleForManagement(updated.role),
			isRoleEditable: isRoleEditableForManagement(updated.role),
		};
	});

export const removeWorkspaceUser = createServerFn({ method: "POST" })
	.middleware([authMiddleware, requirePermission("settings.workspace.write")])
	.inputValidator((data: { userId: string }) => data)
	.handler(async ({ context, data }) => {
		const [existingUser] = await db
			.select({
				id: user.id,
				role: user.role,
			})
			.from(user)
			.where(and(eq(user.id, data.userId), eq(user.clientId, context.clientId)))
			.limit(1);

		if (!existingUser) {
			throw createUserFacingError("User not found.");
		}

		if (!isRoleEditableForManagement(existingUser.role)) {
			throw createUserFacingError("Admin users can't be removed.");
		}

		await db.transaction(async (tx) => {
			await tx.delete(rotationOverride).where(eq(rotationOverride.assigneeId, data.userId));
			await tx.delete(rotationMember).where(eq(rotationMember.assigneeId, data.userId));
			await tx.delete(apiKey).where(eq(apiKey.createdBy, data.userId));
			await tx.delete(user).where(and(eq(user.id, data.userId), eq(user.clientId, context.clientId)));
		});

		return { success: true };
	});

export const getWorkspaceUserProvisioningSettings = createServerFn({ method: "GET" })
	.middleware([authMiddleware, requirePermission("settings.workspace.write")])
	.handler(async ({ context }) => {
		const [workspaceClient] = await db
			.select({
				defaultUserRole: client.defaultUserRole,
				autoCreateUsersWithSso: client.autoCreateUsersWithSso,
			})
			.from(client)
			.where(eq(client.id, context.clientId))
			.limit(1);

		if (!workspaceClient) {
			throw createUserFacingError("Workspace not found.");
		}

		return {
			defaultUserRole: normalizeRoleForManagement(workspaceClient.defaultUserRole),
			autoCreateUsersWithSso: workspaceClient.autoCreateUsersWithSso,
		};
	});

export const updateWorkspaceUserProvisioningSettings = createServerFn({ method: "POST" })
	.middleware([authMiddleware, requirePermission("settings.workspace.write")])
	.inputValidator((data: { defaultUserRole?: ManageableUserRole; autoCreateUsersWithSso?: boolean }) => data)
	.handler(async ({ context, data }) => {
		if (data.defaultUserRole !== undefined && !isManageableRole(data.defaultUserRole)) {
			throw createUserFacingError("Invalid default user permission.");
		}

		const hasDefaultRoleUpdate = data.defaultUserRole !== undefined;
		const hasAutoCreateUpdate = data.autoCreateUsersWithSso !== undefined;

		if (!hasDefaultRoleUpdate && !hasAutoCreateUpdate) {
			const [workspaceClient] = await db
				.select({
					defaultUserRole: client.defaultUserRole,
					autoCreateUsersWithSso: client.autoCreateUsersWithSso,
				})
				.from(client)
				.where(eq(client.id, context.clientId))
				.limit(1);

			if (!workspaceClient) {
				throw createUserFacingError("Workspace not found.");
			}

			return {
				defaultUserRole: normalizeRoleForManagement(workspaceClient.defaultUserRole),
				autoCreateUsersWithSso: workspaceClient.autoCreateUsersWithSso,
			};
		}

		const [updated] = await db
			.update(client)
			.set({
				...(hasDefaultRoleUpdate && { defaultUserRole: data.defaultUserRole }),
				...(hasAutoCreateUpdate && { autoCreateUsersWithSso: data.autoCreateUsersWithSso }),
				updatedAt: new Date(),
			})
			.where(eq(client.id, context.clientId))
			.returning({
				defaultUserRole: client.defaultUserRole,
				autoCreateUsersWithSso: client.autoCreateUsersWithSso,
			});

		if (!updated) {
			throw createUserFacingError("Workspace not found.");
		}

		return {
			defaultUserRole: normalizeRoleForManagement(updated.defaultUserRole),
			autoCreateUsersWithSso: updated.autoCreateUsersWithSso,
		};
	});

export const addWorkspaceUserFromSlack = createServerFn({ method: "POST" })
	.middleware([authMiddleware, requirePermission("settings.workspace.write")])
	.inputValidator((data: { slackUserId: string }) => data)
	.handler(async ({ context, data }) => {
		const [workspaceClient] = await db
			.select({
				id: client.id,
				domains: client.domains,
			})
			.from(client)
			.where(eq(client.id, context.clientId))
			.limit(1);

		if (!workspaceClient) {
			throw createUserFacingError("Workspace not found.");
		}

		const [slackIntegration] = await db
			.select({
				data: integration.data,
			})
			.from(integration)
			.where(and(eq(integration.clientId, context.clientId), eq(integration.platform, "slack")))
			.limit(1);

		if (!slackIntegration?.data) {
			throw createUserFacingError("Slack isn't connected to this workspace.");
		}

		const slackData = slackIntegration.data as SlackIntegrationData;
		const slackUser = await fetchSlackUserById(slackData.botToken, data.slackUserId);
		if (!slackUser) {
			throw createUserFacingError("Slack user not found.");
		}
		if (!slackUser.email) {
			throw createUserFacingError("Slack user has no email.");
		}

		if (!emailInDomains(slackUser.email, workspaceClient.domains ?? [])) {
			throw createUserFacingError("Email domain not allowed for this workspace.");
		}

		const [existingUser] = await db
			.select({
				id: user.id,
				name: user.name,
				email: user.email,
				image: user.image,
				role: user.role,
				slackId: user.slackId,
			})
			.from(user)
			.where(and(eq(user.email, slackUser.email), eq(user.clientId, context.clientId)))
			.limit(1);

		if (existingUser) {
			if (existingUser.slackId && existingUser.slackId !== data.slackUserId) {
				throw createUserFacingError("User linked to a different Slack user.");
			}

			if (!existingUser.slackId) {
				await db
					.update(user)
					.set({
						slackId: data.slackUserId,
						updatedAt: new Date(),
					})
					.where(eq(user.id, existingUser.id));
			}

			return {
				id: existingUser.id,
				name: existingUser.name,
				email: existingUser.email,
				image: existingUser.image,
				slackId: data.slackUserId,
				role: normalizeRoleForManagement(existingUser.role),
				isRoleEditable: isRoleEditableForManagement(existingUser.role),
			};
		}

		let imageUrl: string | null = null;
		if (slackUser.avatar) {
			imageUrl = await uploadImageFromUrl(slackUser.avatar, `users/${context.clientId}`);
		}

		const createdUser = await createWorkspaceUser(db, {
			name: slackUser.name,
			email: slackUser.email,
			emailVerified: true,
			image: imageUrl,
			clientId: context.clientId,
			slackId: data.slackUserId,
		});

		return {
			id: createdUser.id,
			name: createdUser.name,
			email: createdUser.email,
			image: createdUser.image,
			slackId: createdUser.slackId,
			role: normalizeRoleForManagement(createdUser.role),
			isRoleEditable: isRoleEditableForManagement(createdUser.role),
		};
	});
