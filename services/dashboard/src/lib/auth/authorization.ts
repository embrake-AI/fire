import { team, teamMember } from "@fire/db/schema";
import { createMiddleware } from "@tanstack/solid-start";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { createUserFacingError } from "../errors/user-facing-error";
import { hasPermission, type Permission, type UserRole } from "./permissions";

const FORBIDDEN_MESSAGE = "You don't have permission to perform this action.";
const FORBIDDEN_CODE = "FORBIDDEN";

type ContextWithRole = {
	role?: UserRole | null;
	impersonatedBy?: string | null;
};

type TeamWriteContext = ContextWithRole & {
	clientId?: string | null;
	userId?: string | null;
};

function createForbiddenError() {
	return createUserFacingError(FORBIDDEN_MESSAGE, { code: FORBIDDEN_CODE });
}

export function requirePermission(permission: Permission) {
	return createMiddleware({ type: "function" }).server(async ({ context, next }) => {
		const role = (context as ContextWithRole | undefined)?.role;
		if (!hasPermission(role, permission)) {
			throw createForbiddenError();
		}

		return next();
	});
}

export function requirePermissionFromData<TData>(resolvePermission: (data: TData) => Permission) {
	return createMiddleware({ type: "function" }).server(async ({ context, data, next }) => {
		const role = (context as ContextWithRole | undefined)?.role;
		const permission = resolvePermission(data as TData);

		if (!hasPermission(role, permission)) {
			throw createForbiddenError();
		}

		return next();
	});
}

export function assertRolePermission(role: UserRole | null | undefined, permission: Permission): void {
	if (!hasPermission(role, permission)) {
		throw createForbiddenError();
	}
}

export function isAllowed(role: UserRole | null | undefined, permission: Permission): boolean {
	return hasPermission(role, permission);
}

export function isWorkspaceCatalogWriter(role: UserRole | null | undefined): boolean {
	return hasPermission(role, "catalog.write");
}

export async function assertTeamAdminOrWorkspaceCatalogWriter(context: TeamWriteContext, teamId: string | null | undefined): Promise<void> {
	if (isWorkspaceCatalogWriter(context.role)) {
		return;
	}

	if (!hasPermission(context.role, "catalog.read")) {
		throw createForbiddenError();
	}

	if (!teamId || !context.clientId || !context.userId) {
		throw createForbiddenError();
	}

	const [membership] = await db
		.select({ role: teamMember.role })
		.from(teamMember)
		.innerJoin(team, eq(teamMember.teamId, team.id))
		.where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, context.userId), eq(team.clientId, context.clientId)))
		.limit(1);

	if (membership?.role !== "ADMIN") {
		throw createForbiddenError();
	}
}

export function forbiddenJsonResponse() {
	return new Response(
		JSON.stringify({
			error: FORBIDDEN_MESSAGE,
			code: FORBIDDEN_CODE,
		}),
		{
			status: 403,
			headers: { "Content-Type": "application/json" },
		},
	);
}

export function canStopImpersonation(context: ContextWithRole): boolean {
	if (context.impersonatedBy) {
		return true;
	}

	return hasPermission(context.role, "impersonation.write");
}
