import { createFileRoute, Link, Outlet, redirect, useLocation } from "@tanstack/solid-router";
import { Settings } from "lucide-solid";
import { createMemo } from "solid-js";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";

export const Route = createFileRoute("/_authed/config")({
	component: ConfigLayout,
	beforeLoad: ({ location }) => {
		if (location.pathname === "/config") {
			throw redirect({ to: "/config/entry-points" });
		}
	},
});

function ConfigLayout() {
	const location = useLocation();

	const activeTab = createMemo(() => {
		const path = location().pathname;
		if (path.includes("escalation")) return "escalation";
		if (path.includes("integrations")) return "integrations";
		return "entry-points";
	});

	return (
		<div class="flex-1 bg-background p-6 md:p-8">
			<div class="max-w-4xl mx-auto">
				<div class="flex items-center gap-3 mb-6">
					<div class="p-2 rounded-lg bg-muted">
						<Settings class="w-5 h-5 text-muted-foreground" />
					</div>
					<h1 class="text-2xl font-semibold text-foreground">Configuration</h1>
				</div>

				<Tabs value={activeTab()}>
					<TabsList>
						<TabsTrigger value="entry-points" as={Link} to="/config/entry-points">
							Entry Points
						</TabsTrigger>
						<TabsTrigger value="escalation" as={Link} to="/config/escalation">
							Escalation
						</TabsTrigger>
						<TabsTrigger value="integrations" as={Link} to="/config/integrations">
							Integrations
						</TabsTrigger>
					</TabsList>
				</Tabs>

				<div class="mt-6">
					<Outlet />
				</div>
			</div>
		</div>
	);
}
