import { Link, useLocation, useNavigate } from "@tanstack/solid-router";
import { ArrowLeft, BarChart3, BookOpen, Building2, ChevronDown, Flame, Key, LogOut, PanelLeftClose, PanelLeftOpen, Plug, RefreshCw, Settings, User, Users } from "lucide-solid";
import type { Accessor } from "solid-js";
import { createEffect, createMemo, createSignal, For, on, onMount, Show, Suspense } from "solid-js";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { authClient } from "~/lib/auth/auth-client";
import { useAuth } from "~/lib/auth/auth-store";
import { useClient } from "~/lib/client/client.hooks";
import { useIncidents } from "~/lib/incidents/incidents.hooks";
import { useRotations } from "~/lib/rotations/rotations.hooks";
import { useTeams } from "~/lib/teams/teams.hooks";
import { useUsers } from "~/lib/users/users.hooks";
import { cn } from "~/lib/utils/client";
import { Skeleton } from "./ui/skeleton";

type NavItem = {
	label: string;
	to: string;
	icon: typeof Flame;
	exact?: boolean;
	match?: string;
};

const navItems: NavItem[] = [
	{ label: "Incidents", to: "/", icon: Flame, exact: true },
	{ label: "Catalog", to: "/catalog/entry-points", icon: BookOpen, match: "/catalog" },
	{ label: "Metrics", to: "/metrics", icon: BarChart3 },
];

type SettingsNavItemType = {
	label: string;
	to: string;
	icon: typeof User;
	section: "account" | "workspace";
};

const settingsNavItems: SettingsNavItemType[] = [
	{ label: "Profile", to: "/settings/account/profile", section: "account", icon: User },
	{ label: "Connected Accounts", to: "/settings/account/integrations", section: "account", icon: Plug },
	{ label: "API Keys", to: "/settings/account/api-keys", section: "account", icon: Key },
	{ label: "Profile", to: "/settings/workspace/profile", section: "workspace", icon: Building2 },
	{ label: "Integrations", to: "/settings/workspace/integrations", section: "workspace", icon: Plug },
];

function createStoredBoolean(key: string, defaultValue: boolean) {
	const [value, setValue] = createSignal(defaultValue);

	onMount(() => {
		const stored = localStorage.getItem(key);
		if (stored !== null) {
			setValue(stored === "true");
		}
	});

	createEffect(
		on(
			value,
			(next) => {
				localStorage.setItem(key, String(next));
			},
			{ defer: true },
		),
	);

	return [value, setValue] as const;
}

export default function Sidebar() {
	const location = useLocation();
	const [storedCollapsed, setStoredCollapsed] = createStoredBoolean("sidebar-collapsed", false);

	const isSettingsPage = () => location().pathname.startsWith("/settings");

	const collapsed = () => (isSettingsPage() ? false : storedCollapsed());

	const toggleCollapsed = () => {
		setStoredCollapsed((value) => !value);
	};

	return (
		<aside class={cn("flex flex-col bg-zinc-50 border-r border-zinc-200 transition-[width] duration-200 ease-in-out shrink-0", collapsed() ? "w-[60px]" : "w-[200px]")}>
			<div class="flex-1 flex flex-col py-4">
				<Show
					when={isSettingsPage()}
					fallback={
						<>
							<Suspense fallback={<WorkspaceSelectorFallback collapsed={collapsed} />}>
								<WorkspaceSelector collapsed={collapsed} onToggleCollapse={toggleCollapsed} />
							</Suspense>

							<Suspense fallback={<NavItemsSkeleton collapsed={collapsed} />}>
								<SidebarNav collapsed={collapsed} />
							</Suspense>

							<Suspense fallback={<MyTeamsSectionSkeleton collapsed={collapsed} />}>
								<MyTeamsSection collapsed={collapsed} />
							</Suspense>

							<div class="flex-1" />

							<Suspense fallback={<CurrentRotationSkeleton collapsed={collapsed} />}>
								<CurrentRotationSection collapsed={collapsed} />
							</Suspense>
						</>
					}
				>
					<SettingsSidebarContent collapsed={collapsed} />
				</Show>
			</div>
		</aside>
	);
}

function SidebarNav(props: { collapsed: Accessor<boolean> }) {
	const incidentsQuery = useIncidents();
	const hasActiveIncidents = createMemo(() => {
		const incidents = incidentsQuery.data ?? [];
		return incidents.some((inc) => inc.status === "open" || inc.status === "mitigating");
	});

	return (
		<nav class="mt-6 px-2 space-y-1">
			<For each={navItems}>{(item) => <NavItem item={item} collapsed={props.collapsed} hasActiveIncidents={hasActiveIncidents} />}</For>
		</nav>
	);
}

function NavItemsSkeleton(props: { collapsed: Accessor<boolean> }) {
	return (
		<nav class="mt-6 px-2 space-y-1">
			<For each={navItems}>
				{() => (
					<div class="flex items-center gap-3 px-3 py-2 rounded-lg">
						<Skeleton class="w-5 h-5 shrink-0" />
						<Show when={!props.collapsed()}>
							<Skeleton class="h-3 w-16" />
						</Show>
					</div>
				)}
			</For>
		</nav>
	);
}

function NavItem(props: { item: NavItem; collapsed: Accessor<boolean>; hasActiveIncidents: Accessor<boolean> }) {
	const location = useLocation();

	const isActive = () => {
		const path = location().pathname;
		if (props.item.exact) {
			return path === props.item.to;
		}
		return path.startsWith(props.item.match ?? props.item.to);
	};

	const isIgnited = () => props.item.label === "Incidents" && props.hasActiveIncidents();

	return (
		<Tooltip placement="right" openDelay={0} disabled={!props.collapsed()}>
			<TooltipTrigger
				as={Link}
				to={props.item.to}
				class={cn(
					"flex items-center gap-3 px-3 py-2 rounded-lg transition-colors overflow-hidden",
					isActive() ? "bg-zinc-200 text-zinc-900 font-medium shadow-sm" : "text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100",
				)}
			>
				<props.item.icon class={cn("w-5 h-5 shrink-0", isIgnited() && "text-red-500")} />
				<span class={cn("text-sm whitespace-nowrap transition-[opacity,width] duration-200", props.collapsed() ? "opacity-0 w-0" : "opacity-100 w-auto")}>{props.item.label}</span>
			</TooltipTrigger>
			<TooltipContent class="bg-zinc-800 text-white border-zinc-700 px-2 py-1 text-xs">{props.item.label}</TooltipContent>
		</Tooltip>
	);
}

function WorkspaceSelector(props: { collapsed: Accessor<boolean>; onToggleCollapse: () => void }) {
	const clientQuery = useClient();
	const navigate = useNavigate();
	const [open, setOpen] = createSignal(false);
	const [isSigningOut, setIsSigningOut] = createSignal(false);

	const handleSignOut = async () => {
		if (isSigningOut()) return;
		setIsSigningOut(true);
		try {
			await authClient.signOut();
		} finally {
			setIsSigningOut(false);
			setOpen(false);
			navigate({ to: "/login", search: { redirect: "/" } });
		}
	};

	return (
		<div class={cn("px-2 flex items-center justify-between", props.collapsed() && "group/workspace")}>
			<div class={cn("relative", props.collapsed() && "flex-1")}>
				<Popover open={open()} onOpenChange={(isOpen) => !props.collapsed() && setOpen(isOpen)}>
					<PopoverTrigger
						type="button"
						class={cn(
							"flex items-center gap-2 px-2 py-2 rounded-lg text-zinc-700 hover:text-zinc-900 hover:bg-zinc-100 transition-colors overflow-hidden",
							props.collapsed() ? "w-full pointer-events-none" : "cursor-pointer",
						)}
					>
						<Show
							when={clientQuery.data?.image}
							fallback={
								<div class="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-100 to-blue-50 border border-blue-200 flex items-center justify-center shrink-0">
									<Building2 class="w-4 h-4 text-blue-600" />
								</div>
							}
						>
							{(imageUrl) => <img src={imageUrl()} alt={clientQuery.data?.name} class="w-7 h-7 rounded-lg object-cover shrink-0" />}
						</Show>
						<span
							class={cn(
								"text-sm font-medium truncate text-left whitespace-nowrap transition-[opacity,width] duration-200",
								props.collapsed() ? "opacity-0 w-0" : "opacity-100 max-w-20",
							)}
						>
							{clientQuery.data?.name}
						</span>
						<ChevronDown class={cn("w-4 h-4 text-zinc-400 shrink-0 transition-[opacity,width] duration-200", props.collapsed() ? "opacity-0 w-0" : "opacity-100 w-auto")} />
					</PopoverTrigger>
					<PopoverContent class="w-44 p-1">
						<Link
							to="/settings"
							class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-zinc-700 hover:text-zinc-900 hover:bg-zinc-50 transition-colors cursor-pointer"
							onClick={() => setOpen(false)}
						>
							<Settings class="h-4 w-4 text-zinc-400" />
							Settings
						</Link>
						<button
							type="button"
							class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-zinc-700 hover:text-zinc-900 hover:bg-zinc-50 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
							onClick={handleSignOut}
							disabled={isSigningOut()}
						>
							<LogOut class="h-4 w-4 text-zinc-400" />
							{isSigningOut() ? "Logging out..." : "Log out"}
						</button>
					</PopoverContent>
				</Popover>

				<Show when={props.collapsed()}>
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							props.onToggleCollapse();
						}}
						class="absolute left-2 top-1/2 -translate-y-1/2 z-10 w-7 h-7 flex items-center justify-center bg-zinc-900/80 rounded-lg opacity-0 group-hover/workspace:opacity-100 transition-opacity duration-150 cursor-pointer"
					>
						<PanelLeftOpen class="w-3.5 h-3.5 text-white" />
					</button>
				</Show>
			</div>

			<Show when={!props.collapsed()}>
				<button
					type="button"
					onClick={props.onToggleCollapse}
					class="p-1.5 rounded-md text-zinc-400 bg-zinc-100 hover:text-zinc-600 hover:bg-zinc-200 transition-colors shrink-0 cursor-pointer"
				>
					<PanelLeftClose class="w-4 h-4" />
				</button>
			</Show>
		</div>
	);
}

function WorkspaceSelectorFallback(props: { collapsed: Accessor<boolean> }) {
	return (
		<div class={cn("px-2", props.collapsed() && "flex justify-center")}>
			<div class={cn("flex items-center gap-2 px-3 py-2", props.collapsed() && "px-2")}>
				<div class="w-8 h-8 rounded-lg bg-zinc-100 animate-pulse shrink-0" />
				<Show when={!props.collapsed()}>
					<div class="w-20 h-4 rounded bg-zinc-100 animate-pulse" />
				</Show>
			</div>
		</div>
	);
}

function MyTeamsSection(props: { collapsed: Accessor<boolean> }) {
	const auth = useAuth();
	const usersQuery = useUsers();
	const teamsQuery = useTeams();

	const [isOpen, setIsOpen] = createStoredBoolean("sidebar-teams-open", true);

	const userTeams = createMemo(() => {
		const currentUser = usersQuery.data?.find((u) => u.id === auth.userId);
		if (!currentUser) return [];
		const teamIds = new Set([...currentUser.teamIds]);
		return teamsQuery.data?.filter((t) => teamIds.has(t.id)) ?? [];
	});

	return (
		<div class="mt-4 px-2">
			<div class={cn("border-t border-zinc-200 mx-2 transition-all duration-200 ease-in-out", props.collapsed() ? "opacity-100 mb-2 h-px" : "opacity-0 mb-0 h-0")} />
			<Collapsible open={isOpen()} onOpenChange={setIsOpen}>
				<div class={cn("grid transition-all duration-200 ease-in-out", props.collapsed() ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100")}>
					<div class="overflow-hidden">
						<CollapsibleTrigger class="flex items-center justify-between w-full px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-zinc-600 transition-colors cursor-pointer">
							<span>My Teams</span>
							<ChevronDown class={cn("w-3 h-3 transition-transform duration-200", isOpen() ? "rotate-0" : "-rotate-90")} />
						</CollapsibleTrigger>
					</div>
				</div>
				<CollapsibleContent>
					<Show
						when={userTeams().length > 0}
						fallback={
							<Show when={!props.collapsed()}>
								<p class="px-3 py-1.5 text-xs text-zinc-400">No teams</p>
							</Show>
						}
					>
						<div class={cn("space-y-0.5", !props.collapsed() && "mt-1")}>
							<For each={userTeams()}>{(team) => <TeamNavItem team={team} collapsed={props.collapsed} />}</For>
						</div>
					</Show>
				</CollapsibleContent>
			</Collapsible>
		</div>
	);
}

function TeamNavItem(props: { team: { id: string; name: string; imageUrl: string | null }; collapsed: Accessor<boolean> }) {
	const location = useLocation();

	const isActive = () => location().pathname.startsWith(`/teams/${props.team.id}`);

	return (
		<Tooltip placement="right" openDelay={0} disabled={!props.collapsed()}>
			<TooltipTrigger as="div">
				<Link
					to="/teams/$teamId/users"
					params={{ teamId: props.team.id } as { teamId: string }}
					class={cn(
						"flex items-center px-3 py-1.5 rounded-lg transition-all overflow-hidden",
						props.collapsed() ? "justify-center px-1.5" : "gap-2",
						isActive() ? "bg-zinc-200 text-zinc-900 font-medium" : "text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100",
					)}
				>
					<TeamAvatar team={props.team} size="xs" />
					<span class={cn("text-sm truncate whitespace-nowrap transition-[opacity,width] duration-200", props.collapsed() ? "opacity-0 w-0" : "opacity-100 w-auto")}>
						{props.team.name}
					</span>
				</Link>
			</TooltipTrigger>
			<TooltipContent class="bg-zinc-800 text-white border-zinc-700 px-2 py-1 text-xs">{props.team.name}</TooltipContent>
		</Tooltip>
	);
}

function TeamAvatar(props: { team: { name: string; imageUrl: string | null }; size?: "xs" | "sm" }) {
	const sizeClass = () => (props.size === "xs" ? "w-5 h-5" : "w-6 h-6");
	const iconSize = () => (props.size === "xs" ? "w-3 h-3" : "w-3.5 h-3.5");

	return (
		<Show
			when={props.team.imageUrl}
			fallback={
				<div class={cn(sizeClass(), "rounded-md bg-gradient-to-br from-blue-100 to-blue-50 border border-blue-200 flex items-center justify-center shrink-0")}>
					<Users class={cn(iconSize(), "text-blue-600")} />
				</div>
			}
		>
			{(imageUrl) => <img src={imageUrl()} alt={props.team.name} class={cn(sizeClass(), "rounded-md object-cover shrink-0")} />}
		</Show>
	);
}

function MyTeamsSectionSkeleton(props: { collapsed: Accessor<boolean> }) {
	return (
		<div class={cn("mt-4 px-2", props.collapsed() && "flex flex-col items-center gap-1")}>
			<Show
				when={!props.collapsed()}
				fallback={
					<>
						<Skeleton class="w-6 h-6 rounded-md" />
						<Skeleton class="w-6 h-6 rounded-md" />
					</>
				}
			>
				<Skeleton class="h-4 w-16 mb-2 ml-3" />
				<div class="space-y-1">
					<Skeleton class="h-8 w-full rounded-lg" />
					<Skeleton class="h-8 w-full rounded-lg" />
				</div>
			</Show>
		</div>
	);
}

function SettingsSidebarContent(props: { collapsed: Accessor<boolean> }) {
	const accountItems = settingsNavItems.filter((item) => item.section === "account");
	const workspaceItems = settingsNavItems.filter((item) => item.section === "workspace");

	return (
		<>
			<div class="px-2">
				<Link
					to="/"
					class={cn(
						"flex items-center gap-2 px-3 py-2 rounded-lg text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors",
						props.collapsed() && "justify-center px-2",
					)}
				>
					<ArrowLeft class="w-4 h-4 shrink-0" />
					<span class={cn("text-sm whitespace-nowrap transition-[opacity,width] duration-200", props.collapsed() ? "opacity-0 w-0" : "opacity-100 w-auto")}>Back</span>
				</Link>
			</div>

			<div class={cn("mt-4 px-2", props.collapsed() && "px-1")}>
				<Show when={!props.collapsed()}>
					<h2 class="px-3 mb-3 text-sm font-semibold text-zinc-900">Settings</h2>
				</Show>

				<div class="space-y-4">
					<div>
						<span class={cn("px-3 text-[10px] font-medium text-zinc-400 uppercase tracking-wider", props.collapsed() && "hidden")}>Account</span>
						<div class={cn("space-y-0.5", !props.collapsed() && "mt-1")}>
							<For each={accountItems}>{(item) => <SettingsNavItem item={item} collapsed={props.collapsed} />}</For>
						</div>
					</div>
					<div>
						<span class={cn("px-3 text-[10px] font-medium text-zinc-400 uppercase tracking-wider", props.collapsed() && "hidden")}>Workspace</span>
						<div class={cn("space-y-0.5", !props.collapsed() && "mt-1")}>
							<For each={workspaceItems}>{(item) => <SettingsNavItem item={item} collapsed={props.collapsed} />}</For>
						</div>
					</div>
				</div>
			</div>
		</>
	);
}

function SettingsNavItem(props: { item: SettingsNavItemType; collapsed: Accessor<boolean> }) {
	const location = useLocation();
	const isActive = () => location().pathname === props.item.to;

	return (
		<Tooltip placement="right" openDelay={0} disabled={!props.collapsed()}>
			<TooltipTrigger as="div">
				<Link
					to={props.item.to}
					class={cn(
						"flex items-center px-3 py-1.5 rounded-lg transition-all overflow-hidden",
						props.collapsed() ? "justify-center px-1.5" : "gap-2",
						isActive() ? "bg-zinc-200 text-zinc-900 font-medium" : "text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100",
					)}
				>
					<props.item.icon class="w-4 h-4 shrink-0" />
					<span class={cn("text-sm truncate whitespace-nowrap transition-[opacity,width] duration-200", props.collapsed() ? "opacity-0 w-0" : "opacity-100 w-auto")}>
						{props.item.label}
					</span>
				</Link>
			</TooltipTrigger>
			<TooltipContent class="bg-zinc-800 text-white border-zinc-700 px-2 py-1 text-xs">{props.item.label}</TooltipContent>
		</Tooltip>
	);
}

function CurrentRotationSection(props: { collapsed: Accessor<boolean> }) {
	const auth = useAuth();
	const rotationsQuery = useRotations();

	const currentRotation = createMemo(() => {
		if (!auth.userId || !rotationsQuery.data) return null;
		return rotationsQuery.data.find((r) => r.currentAssignee === auth.userId);
	});

	return (
		<Show when={currentRotation()}>
			{(rotation) => (
				<div class="px-2 pb-2">
					<div class="border-t border-zinc-200 pt-3">
						<Tooltip placement="right" openDelay={0} disabled={!props.collapsed()}>
							<TooltipTrigger as="div" class="flex w-full">
								<Link
									to="/rotations/$rotationId"
									params={{ rotationId: rotation().id }}
									class={cn(
										"flex items-center py-2 rounded-lg bg-violet-50 border border-violet-200 transition-all duration-200 overflow-hidden hover:bg-violet-100",
										props.collapsed() ? "w-10 px-2 mx-auto" : "w-full px-3 gap-2",
									)}
								>
									<div class="w-6 h-6 rounded-md bg-violet-100 border border-violet-200 flex items-center justify-center shrink-0">
										<RefreshCw class="w-3.5 h-3.5 text-violet-600" />
									</div>
									<div class={cn("flex flex-col min-w-0 transition-opacity duration-200", props.collapsed() ? "opacity-0 w-0" : "opacity-100")}>
										<span class="text-[10px] font-medium text-violet-600 uppercase tracking-wider whitespace-nowrap">On Call</span>
										<span class="text-sm font-medium text-zinc-900 truncate whitespace-nowrap">{rotation().name}</span>
									</div>
								</Link>
							</TooltipTrigger>
							<TooltipContent class="bg-zinc-800 text-white border-zinc-700 px-2 py-1 text-xs">
								<span class="text-violet-300">On Call:</span> {rotation().name}
							</TooltipContent>
						</Tooltip>
					</div>
				</div>
			)}
		</Show>
	);
}

function CurrentRotationSkeleton(props: { collapsed: Accessor<boolean> }) {
	return (
		<div class="px-2 pb-2">
			<div class="border-t border-zinc-200 pt-3 flex w-full">
				<div
					class={cn(
						"flex items-center py-2 rounded-lg bg-zinc-50 border border-zinc-200 transition-all duration-200 overflow-hidden",
						props.collapsed() ? "w-10 px-2 mx-auto" : "w-full px-3 gap-2",
					)}
				>
					<Skeleton class="w-6 h-6 rounded-md shrink-0" />
					<div class={cn("flex flex-col gap-1 transition-opacity duration-200", props.collapsed() ? "opacity-0 w-0" : "opacity-100")}>
						<Skeleton class="h-2.5 w-12" />
						<Skeleton class="h-4 w-20" />
					</div>
				</div>
			</div>
		</div>
	);
}
