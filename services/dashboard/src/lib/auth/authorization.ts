import { createMiddleware } from "@tanstack/solid-start";
import { createUserFacingError } from "../errors/user-facing-error";
import { hasPermission, type Permission, type UserRole } from "./permissions";

const FORBIDDEN_MESSAGE = "You don't have permission to perform this action.";
const FORBIDDEN_CODE = "FORBIDDEN";

type ContextWithRole = {
	role?: UserRole | null;
	impersonatedBy?: string | null;
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
