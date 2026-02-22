import { redirect } from "@tanstack/solid-router";
import { isDemoMode } from "../demo/mode";
import { getAuth, isAuthReady } from "./auth-store";
import { hasPermission, type Permission } from "./permissions";

type RouteBeforeLoadArgs = {
	location: {
		href: string;
		pathname: string;
	};
};

export function requireRoutePermission(permission: Permission) {
	return ({ location }: RouteBeforeLoadArgs) => {
		if (!isAuthReady()) {
			return;
		}

		const auth = getAuth();
		if (!auth?.userId || !auth?.clientId) {
			return;
		}
		const role = isDemoMode() ? "ADMIN" : auth.role;

		if (!hasPermission(role, permission)) {
			throw redirect({
				to: "/unauthorized",
				search: { from: location.href || location.pathname },
			});
		}
	};
}
