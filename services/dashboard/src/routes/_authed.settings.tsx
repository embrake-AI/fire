import { createFileRoute, Link, Outlet, redirect, useLocation } from "@tanstack/solid-router";
import { Building2, Key, Plug, User } from "lucide-solid";
import { cn } from "~/lib/utils/client";

export const Route = createFileRoute("/_authed/settings")({
	component: SettingsLayout,
	beforeLoad: ({ location }) => {
		if (location.pathname === "/settings" || location.pathname === "/settings/") {
			throw redirect({ to: "/settings/account/profile" });
		}
	},
});

const navItems = [
	{ label: "Profile", to: "/settings/account/profile", section: "account", icon: User },
	{ label: "Integrations", to: "/settings/account/integrations", section: "account", icon: Plug },
	{ label: "API Keys", to: "/settings/account/api-keys", section: "account", icon: Key },
	{ label: "Profile", to: "/settings/workspace/profile", section: "workspace", icon: Building2 },
	{ label: "Integrations", to: "/settings/workspace/integrations", section: "workspace", icon: Plug },
] as const;

function SettingsLayout() {
	const location = useLocation();

	const isActive = (to: string) => location().pathname === to;

	return (
		<div class="flex-1 bg-background">
			<div class="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10 lg:flex-row lg:gap-12">
				<aside class="w-full shrink-0 lg:w-60 lg:self-start">
					<h1 class="text-base font-semibold text-foreground mb-4">Settings</h1>

					<nav class="space-y-6">
						<div>
							<span class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Account</span>
							<ul class="mt-2 space-y-1">
								{navItems
									.filter((item) => item.section === "account")
									.map((item) => (
										<li>
											<Link
												to={item.to}
												aria-current={isActive(item.to) ? "page" : undefined}
												class={cn(
													"group flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
													isActive(item.to) ? "bg-muted/80 text-foreground font-medium" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
												)}
											>
												<item.icon class={cn("h-4 w-4 transition-colors", isActive(item.to) ? "text-foreground" : "text-muted-foreground group-hover:text-foreground")} />
												<span>{item.label}</span>
											</Link>
										</li>
									))}
							</ul>
						</div>

						<div>
							<span class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Workspace</span>
							<ul class="mt-2 space-y-1">
								{navItems
									.filter((item) => item.section === "workspace")
									.map((item) => (
										<li>
											<Link
												to={item.to}
												aria-current={isActive(item.to) ? "page" : undefined}
												class={cn(
													"group flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
													isActive(item.to) ? "bg-muted/80 text-foreground font-medium" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
												)}
											>
												<item.icon class={cn("h-4 w-4 transition-colors", isActive(item.to) ? "text-foreground" : "text-muted-foreground group-hover:text-foreground")} />
												<span>{item.label}</span>
											</Link>
										</li>
									))}
							</ul>
						</div>
					</nav>
				</aside>

				<main class="flex-1 min-w-0">
					<div class="max-w-3xl">
						<Outlet />
					</div>
				</main>
			</div>
		</div>
	);
}
