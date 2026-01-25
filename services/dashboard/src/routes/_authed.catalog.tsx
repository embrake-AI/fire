import { createFileRoute, Link, Outlet, redirect, useLocation } from "@tanstack/solid-router";
import { BookOpen } from "lucide-solid";
import { createMemo } from "solid-js";
import { Tabs, TabsIndicator, TabsList, TabsTrigger } from "~/components/ui/tabs";

export const Route = createFileRoute("/_authed/catalog")({
	component: CatalogLayout,
	beforeLoad: ({ location }) => {
		if (location.pathname === "/catalog") {
			throw redirect({ to: "/catalog/entry-points" });
		}
	},
});

function CatalogLayout() {
	const location = useLocation();

	const activeTab = createMemo(() => {
		const path = location().pathname;
		if (path.includes("teams")) return "teams";
		if (path.includes("rotation")) return "rotation";
		if (path.includes("services")) return "services";
		if (path.includes("escalation")) return "escalation";
		return "entry-points";
	});

	return (
		<div class="flex-1 bg-background p-6 md:p-8">
			<div class="max-w-5xl mx-auto">
				<div class="flex items-center gap-3 mb-6">
					<div class="p-2 rounded-lg bg-muted">
						<BookOpen class="w-5 h-5 text-muted-foreground" />
					</div>
					<h1 class="text-2xl font-semibold text-foreground">Catalog</h1>
				</div>

				<Tabs value={activeTab()}>
					<TabsList>
						<TabsTrigger value="entry-points" as={Link} to="/catalog/entry-points">
							Entry Points
						</TabsTrigger>
						<TabsTrigger value="teams" as={Link} to="/catalog/teams">
							Teams
						</TabsTrigger>
						<TabsTrigger value="rotation" as={Link} to="/catalog/rotation">
							Rotations
						</TabsTrigger>
						<TabsTrigger value="services" as={Link} to="/catalog/services">
							Services
						</TabsTrigger>
						<TabsTrigger value="escalation" as={Link} to="/catalog/escalation">
							Escalations
						</TabsTrigger>
						<TabsIndicator />
					</TabsList>
				</Tabs>

				<div class="mt-6">
					<Outlet />
				</div>
			</div>
		</div>
	);
}
