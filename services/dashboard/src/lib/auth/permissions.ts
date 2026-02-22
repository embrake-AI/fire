import type { userRole } from "@fire/db/schema";

export type UserRole = (typeof userRole.enumValues)[number];

export type Permission =
	| "incident.read"
	| "incident.write"
	| "catalog.read"
	| "catalog.write"
	| "metrics.read"
	| "settings.account.read"
	| "settings.account.write"
	| "settings.workspace.read"
	| "settings.workspace.write"
	| "apiKeys.read"
	| "apiKeys.write"
	| "metricsApi.read"
	| "rotationWorkflow.trigger"
	| "impersonation.write";

const VIEWER_PERMISSIONS: readonly Permission[] = ["incident.read"];
const MEMBER_PERMISSIONS: readonly Permission[] = [...VIEWER_PERMISSIONS, "incident.write", "catalog.read", "metrics.read", "settings.account.read"];
const ADMIN_PERMISSIONS: readonly Permission[] = [
	...MEMBER_PERMISSIONS,
	"catalog.write",
	"settings.account.write",
	"settings.workspace.read",
	"settings.workspace.write",
	"apiKeys.read",
	"apiKeys.write",
	"metricsApi.read",
];
const SUPER_ADMIN_PERMISSIONS: readonly Permission[] = [...ADMIN_PERMISSIONS, "rotationWorkflow.trigger", "impersonation.write"];

export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
	VIEWER: VIEWER_PERMISSIONS,
	MEMBER: MEMBER_PERMISSIONS,
	ADMIN: ADMIN_PERMISSIONS,
	SUPER_ADMIN: SUPER_ADMIN_PERMISSIONS,
};

export function hasPermission(role: UserRole | null | undefined, permission: Permission): boolean {
	if (!role) return false;
	return ROLE_PERMISSIONS[role].includes(permission);
}
