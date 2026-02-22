import { createFileRoute, Outlet, redirect } from "@tanstack/solid-router";
import { requireRoutePermission } from "~/lib/auth/route-guards";

export const Route = createFileRoute("/_authed/settings")({
	component: SettingsLayout,
	beforeLoad: ({ location }) => {
		requireRoutePermission("settings.account.read")({ location });
		if (location.pathname === "/settings" || location.pathname === "/settings/") {
			throw redirect({ to: "/settings/account/profile" });
		}
	},
});

function SettingsLayout() {
	return (
		<div class="flex-1 bg-background px-6 py-12 md:px-8 md:py-16">
			<div class="max-w-2xl mx-auto">
				<Outlet />
			</div>
		</div>
	);
}
