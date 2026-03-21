import { createFileRoute } from "@tanstack/solid-router";
import { format } from "date-fns";
import { BarChart3, Building2, type CalendarDays, LoaderCircle, Search, Shield, Users } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Show, Suspense } from "solid-js";
import { UserAvatar } from "~/components/UserAvatar";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { Tabs, TabsContent, TabsIndicator, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { requireRoutePermission } from "~/lib/auth/route-guards";
import { useStartImpersonating, useSuperAdminClients, useSuperAdminClientUsers, useSuperAdminClientWeeklyUsage } from "~/lib/auth/super-admin.hooks";
import { cn } from "~/lib/utils/client";

export const Route = createFileRoute("/_authed/super-admin")({
	beforeLoad: requireRoutePermission("impersonation.write"),
	component: SuperAdminPage,
});

function clientMatchesQuery(clientName: string, domains: string[] | null, query: string) {
	if (!query) return true;
	const matchesName = clientName.toLowerCase().includes(query);
	const matchesDomain = (domains ?? []).some((domain) => domain.toLowerCase().includes(query));
	return matchesName || matchesDomain;
}

function formatWeekLabel(weekStartIso: string, weekEndIso: string) {
	return `${format(new Date(weekStartIso), "MMM d")} - ${format(new Date(weekEndIso), "MMM d")}`;
}

function SuperAdminPage() {
	return (
		<div class="flex-1 bg-background px-6 py-12 md:px-8 md:py-16">
			<div class="max-w-6xl mx-auto space-y-8 h-full min-h-0">
				<div>
					<h2 class="text-lg font-semibold text-foreground">Super Admin</h2>
					<p class="text-sm text-muted-foreground mt-1">Client-level analytics and user impersonation.</p>
				</div>
				<Suspense fallback={<SuperAdminSkeleton />}>
					<SuperAdminContent />
				</Suspense>
			</div>
		</div>
	);
}

function SuperAdminContent() {
	const clientsQuery = useSuperAdminClients();
	const startImpersonatingMutation = useStartImpersonating();
	const [selectedClientId, setSelectedClientId] = createSignal<string | null>(null);
	const [activeTab, setActiveTab] = createSignal("analytics");
	const [impersonationClientSearchQuery, setImpersonationClientSearchQuery] = createSignal("");
	const [analyticsClientSearchQuery, setAnalyticsClientSearchQuery] = createSignal("");
	const [userSearchQuery, setUserSearchQuery] = createSignal("");

	createEffect(() => {
		const clients = clientsQuery.data ?? [];
		if (clients.length === 0) {
			setSelectedClientId(null);
			return;
		}

		if (!selectedClientId()) {
			setSelectedClientId(clients[0].id);
			return;
		}

		if (!clients.some((workspaceClient) => workspaceClient.id === selectedClientId())) {
			setSelectedClientId(clients[0].id);
		}
	});

	const weeklyUsageQuery = useSuperAdminClientWeeklyUsage(selectedClientId, { weeks: 12 });
	const usersQuery = useSuperAdminClientUsers(selectedClientId);

	const filteredImpersonationClients = createMemo(() => {
		const query = impersonationClientSearchQuery().trim().toLowerCase();
		const clients = clientsQuery.data ?? [];
		return clients.filter((workspaceClient) => clientMatchesQuery(workspaceClient.name, workspaceClient.domains ?? null, query));
	});

	const filteredAnalyticsClients = createMemo(() => {
		const query = analyticsClientSearchQuery().trim().toLowerCase();
		const clients = clientsQuery.data ?? [];
		return clients.filter((workspaceClient) => clientMatchesQuery(workspaceClient.name, workspaceClient.domains ?? null, query));
	});

	const selectedClient = createMemo(() => (clientsQuery.data ?? []).find((workspaceClient) => workspaceClient.id === selectedClientId()) ?? null);

	const filteredUsers = createMemo(() => {
		const query = userSearchQuery().trim().toLowerCase();
		const users = usersQuery.data ?? [];
		if (!query) {
			return users;
		}

		return users.filter((workspaceUser) => workspaceUser.name.toLowerCase().includes(query) || workspaceUser.email.toLowerCase().includes(query));
	});

	const weeklyTimeline = createMemo(() => weeklyUsageQuery.data?.timeline ?? []);
	const timelineTotals = createMemo(() =>
		weeklyTimeline().reduce(
			(acc, week) => ({
				incidentCount: acc.incidentCount + week.incidentCount,
				statusPageUpdateCount: acc.statusPageUpdateCount + week.statusPageUpdateCount,
			}),
			{ incidentCount: 0, statusPageUpdateCount: 0 },
		),
	);

	const handleImpersonate = async (userId: string) => {
		await startImpersonatingMutation.mutateAsync({ userId });
		window.location.assign("/");
	};

	return (
		<Tabs value={activeTab()} onChange={setActiveTab}>
			<div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
				<div>
					<p class="text-sm font-medium text-foreground">Workspace controls</p>
					<p class="text-xs text-muted-foreground">Analytics is scoped to one selected client, not globally aggregated.</p>
				</div>
				<TabsList>
					<TabsTrigger value="analytics" class="gap-2">
						<BarChart3 class="size-4" />
						Analytics
					</TabsTrigger>
					<TabsTrigger value="impersonation" class="gap-2">
						<Shield class="size-4" />
						Impersonation
					</TabsTrigger>
					<TabsIndicator />
				</TabsList>
			</div>

			<TabsContent value="analytics">
				<div class="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)] min-h-0">
					<section class="rounded-xl bg-muted/20 px-4 py-2 max-h-[70vh] overflow-hidden flex flex-col min-h-0">
						<div class="py-3 border-b border-border/40 shrink-0">
							<div class="flex items-center gap-2 mb-3">
								<Building2 class="size-4 text-muted-foreground" />
								<p class="text-sm font-medium text-foreground">Clients</p>
							</div>
							<div class="relative">
								<Search class="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
								<input
									type="text"
									placeholder="Search clients..."
									value={analyticsClientSearchQuery()}
									onInput={(event) => setAnalyticsClientSearchQuery(event.currentTarget.value)}
									class="flex h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
								/>
							</div>
						</div>
						<div class="py-3 overflow-y-auto min-h-0 pr-2">
							<Show when={filteredAnalyticsClients().length > 0} fallback={<p class="text-sm text-muted-foreground">No clients found.</p>}>
								<div class="space-y-1">
									<For each={filteredAnalyticsClients()}>
										{(workspaceClient) => (
											<button
												type="button"
												class={cn(
													"w-full rounded-md border px-3 py-2 text-left transition-colors cursor-pointer",
													selectedClientId() === workspaceClient.id ? "border-zinc-300 bg-zinc-100" : "border-transparent hover:border-zinc-200 hover:bg-zinc-50",
												)}
												onClick={() => setSelectedClientId(workspaceClient.id)}
											>
												<p class="text-sm font-medium text-foreground truncate">{workspaceClient.name}</p>
												<p class="text-xs text-muted-foreground truncate">{(workspaceClient.domains ?? []).join(", ") || "No domains configured"}</p>
											</button>
										)}
									</For>
								</div>
							</Show>
						</div>
					</section>

					<section class="rounded-xl bg-muted/20 px-4 py-2 max-h-[70vh] overflow-hidden flex flex-col min-h-0">
						<div class="py-3 border-b border-border/40 shrink-0">
							<div class="flex items-center justify-between gap-3">
								<div class="min-w-0">
									<div class="flex items-center gap-2">
										<BarChart3 class="size-4 text-muted-foreground" />
										<p class="text-sm font-medium text-foreground truncate">{selectedClient()?.name ?? "Client analytics"}</p>
									</div>
									<p class="text-xs text-muted-foreground mt-1">Weekly incidents and status page updates (last 12 weeks).</p>
								</div>
								<Badge variant="secondary">{weeklyTimeline().length} weeks</Badge>
							</div>
						</div>

						<div class="py-3 overflow-y-auto min-h-0 pr-2 space-y-4">
							<Show when={selectedClientId()} fallback={<p class="text-sm text-muted-foreground">Select a client to view analytics.</p>}>
								<Show when={!weeklyUsageQuery.isPending} fallback={<p class="text-sm text-muted-foreground">Loading client analytics...</p>}>
									<div class="grid gap-3 md:grid-cols-3">
										<CurrentUsageCard label="Rotations" value={weeklyUsageQuery.data?.current.rotationCount ?? 0} icon={Users} />
										<CurrentUsageCard label="People In Rotation" value={weeklyUsageQuery.data?.current.peopleInRotationCount ?? 0} icon={Users} />
										<CurrentUsageCard label="Status Pages" value={weeklyUsageQuery.data?.current.statusPageCount ?? 0} icon={Building2} />
									</div>

									<div class="rounded-lg border border-border/50 bg-background px-3 py-2">
										<div class="flex items-center justify-between gap-3">
											<p class="text-sm font-medium text-foreground">Timeline totals (12 weeks)</p>
											<div class="flex items-center gap-3 text-xs text-muted-foreground">
												<span>Incidents: {timelineTotals().incidentCount}</span>
												<span>Updates: {timelineTotals().statusPageUpdateCount}</span>
											</div>
										</div>
									</div>

									<Show when={weeklyTimeline().length > 0} fallback={<p class="text-sm text-muted-foreground">No timeline data available.</p>}>
										<WeeklyUsageLineChart timeline={weeklyTimeline()} />
									</Show>
								</Show>
							</Show>
						</div>
					</section>
				</div>
			</TabsContent>

			<TabsContent value="impersonation">
				<div class="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)] min-h-0">
					<section class="rounded-xl bg-muted/20 px-4 py-2 max-h-[70vh] overflow-hidden flex flex-col min-h-0">
						<div class="py-3 border-b border-border/40 shrink-0">
							<div class="flex items-center gap-2 mb-3">
								<Building2 class="size-4 text-muted-foreground" />
								<p class="text-sm font-medium text-foreground">Clients</p>
							</div>
							<div class="relative">
								<Search class="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
								<input
									type="text"
									placeholder="Search clients..."
									value={impersonationClientSearchQuery()}
									onInput={(event) => setImpersonationClientSearchQuery(event.currentTarget.value)}
									class="flex h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
								/>
							</div>
						</div>
						<div class="py-3 overflow-y-auto min-h-0 pr-2">
							<Show when={filteredImpersonationClients().length > 0} fallback={<p class="text-sm text-muted-foreground">No clients found.</p>}>
								<div class="space-y-1">
									<For each={filteredImpersonationClients()}>
										{(workspaceClient) => (
											<button
												type="button"
												class={cn(
													"w-full rounded-md border px-3 py-2 text-left transition-colors cursor-pointer",
													selectedClientId() === workspaceClient.id ? "border-zinc-300 bg-zinc-100" : "border-transparent hover:border-zinc-200 hover:bg-zinc-50",
												)}
												onClick={() => setSelectedClientId(workspaceClient.id)}
											>
												<p class="text-sm font-medium text-foreground truncate">{workspaceClient.name}</p>
												<p class="text-xs text-muted-foreground truncate">{(workspaceClient.domains ?? []).join(", ") || "No domains configured"}</p>
											</button>
										)}
									</For>
								</div>
							</Show>
						</div>
					</section>

					<section class="rounded-xl bg-muted/20 px-4 py-2 max-h-[70vh] overflow-hidden flex flex-col min-h-0">
						<div class="py-3 border-b border-border/40 shrink-0">
							<div class="flex items-center justify-between gap-3">
								<div class="min-w-0">
									<div class="flex items-center gap-2">
										<Users class="size-4 text-muted-foreground" />
										<p class="text-sm font-medium text-foreground truncate">{selectedClient()?.name ?? "Users"}</p>
									</div>
									<p class="text-xs text-muted-foreground mt-1">Impersonate any user in this client.</p>
								</div>
							</div>
							<div class="relative mt-3">
								<Search class="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
								<input
									type="text"
									placeholder="Search users..."
									value={userSearchQuery()}
									onInput={(event) => setUserSearchQuery(event.currentTarget.value)}
									class="flex h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
								/>
							</div>
						</div>

						<div class="py-3 overflow-y-auto min-h-0 pr-2">
							<Show when={selectedClientId()} fallback={<p class="text-sm text-muted-foreground">Select a client to view users.</p>}>
								<Show when={!usersQuery.isPending} fallback={<p class="text-sm text-muted-foreground">Loading users...</p>}>
									<Show when={filteredUsers().length > 0} fallback={<p class="text-sm text-muted-foreground">No users found.</p>}>
										<div class="divide-y divide-border/40">
											<For each={filteredUsers()}>
												{(workspaceUser) => (
													<div class="py-3 flex items-center justify-between gap-3">
														<div class="flex items-center gap-3 min-w-0">
															<UserAvatar name={() => workspaceUser.name} avatar={() => workspaceUser.image} />
															<div class="min-w-0">
																<p class="text-sm font-medium text-foreground truncate">{workspaceUser.name}</p>
																<p class="text-xs text-muted-foreground truncate">{workspaceUser.email}</p>
															</div>
														</div>
														<div class="flex items-center gap-2 shrink-0">
															<Badge variant="secondary">{workspaceUser.role}</Badge>
															<Button size="sm" onClick={() => void handleImpersonate(workspaceUser.id)} disabled={startImpersonatingMutation.isPending} class="min-w-28">
																<Show
																	when={startImpersonatingMutation.isPending && startImpersonatingMutation.variables?.userId === workspaceUser.id}
																	fallback={
																		<>
																			<Shield class="w-4 h-4 mr-2" />
																			Impersonate
																		</>
																	}
																>
																	<LoaderCircle class="w-4 h-4 animate-spin mr-2" />
																	Starting...
																</Show>
															</Button>
														</div>
													</div>
												)}
											</For>
										</div>
									</Show>
								</Show>
							</Show>
						</div>
					</section>
				</div>
			</TabsContent>
		</Tabs>
	);
}

function CurrentUsageCard(props: { label: string; value: number; icon: typeof CalendarDays }) {
	return (
		<div class="rounded-lg border border-border/60 bg-background px-3 py-2">
			<div class="flex items-center justify-between gap-2">
				<p class="text-xs text-muted-foreground">{props.label}</p>
				<props.icon class="size-4 text-muted-foreground" />
			</div>
			<p class="text-lg font-semibold text-foreground mt-1">{props.value.toLocaleString()}</p>
		</div>
	);
}

type WeeklyUsagePoint = {
	weekStart: string;
	weekEnd: string;
	incidentCount: number;
	statusPageUpdateCount: number;
};

function WeeklyUsageLineChart(props: { timeline: WeeklyUsagePoint[] }) {
	const chartWidth = 920;
	const chartHeight = 260;
	const padding = {
		top: 16,
		right: 16,
		bottom: 40,
		left: 36,
	};
	const usableWidth = chartWidth - padding.left - padding.right;
	const usableHeight = chartHeight - padding.top - padding.bottom;
	const pointCount = () => props.timeline.length;
	const maxValue = () => Math.max(1, ...props.timeline.map((week) => Math.max(week.incidentCount, week.statusPageUpdateCount)));
	const xAt = (index: number) => padding.left + (pointCount() > 1 ? (index / (pointCount() - 1)) * usableWidth : usableWidth / 2);
	const yAt = (value: number) => padding.top + (1 - value / maxValue()) * usableHeight;

	const incidentPath = () => props.timeline.map((week, index) => `${index === 0 ? "M" : "L"} ${xAt(index)} ${yAt(week.incidentCount)}`).join(" ");
	const statusUpdatePath = () => props.timeline.map((week, index) => `${index === 0 ? "M" : "L"} ${xAt(index)} ${yAt(week.statusPageUpdateCount)}`).join(" ");
	const yTicks = () => [0, 0.25, 0.5, 0.75, 1];
	const xLabelIndices = () => {
		if (pointCount() <= 1) return [0];
		const middle = Math.floor((pointCount() - 1) / 2);
		const last = pointCount() - 1;
		return Array.from(new Set([0, middle, last]));
	};

	return (
		<div class="rounded-lg border border-border/50 bg-background p-3 space-y-3">
			<div class="flex items-center gap-4 text-xs text-muted-foreground">
				<span class="inline-flex items-center gap-1.5">
					<span class="w-3 h-0.5 bg-blue-500 rounded" />
					Incidents
				</span>
				<span class="inline-flex items-center gap-1.5">
					<span class="w-3 h-0.5 bg-emerald-500 rounded" />
					Status updates
				</span>
			</div>
			<svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} class="w-full h-auto">
				<title>Weekly incidents and status updates</title>
				<For each={yTicks()}>
					{(tick) => {
						const y = padding.top + tick * usableHeight;
						const valueLabel = Math.round((1 - tick) * maxValue());
						return (
							<>
								<line x1={padding.left} y1={y} x2={chartWidth - padding.right} y2={y} stroke="currentColor" stroke-opacity="0.12" />
								<text x={padding.left - 6} y={y + 4} text-anchor="end" class="fill-muted-foreground text-[10px]">
									{valueLabel}
								</text>
							</>
						);
					}}
				</For>

				<path d={incidentPath()} fill="none" stroke="#3b82f6" stroke-width="2.5" />
				<path d={statusUpdatePath()} fill="none" stroke="#10b981" stroke-width="2.5" />

				<For each={props.timeline}>
					{(week, index) => (
						<>
							<circle cx={xAt(index())} cy={yAt(week.incidentCount)} r="2.5" fill="#3b82f6" />
							<circle cx={xAt(index())} cy={yAt(week.statusPageUpdateCount)} r="2.5" fill="#10b981" />
						</>
					)}
				</For>

				<For each={xLabelIndices()}>
					{(index) => (
						<text x={xAt(index)} y={chartHeight - 10} text-anchor="middle" class="fill-muted-foreground text-[10px]">
							{formatWeekLabel(props.timeline[index].weekStart, props.timeline[index].weekEnd)}
						</text>
					)}
				</For>
			</svg>
		</div>
	);
}

function SuperAdminSkeleton() {
	return (
		<div class="space-y-4">
			<div class="flex items-center justify-between">
				<div class="space-y-1">
					<Skeleton class="h-4 w-28" />
					<Skeleton class="h-3 w-52" />
				</div>
				<Skeleton class="h-8 w-56" />
			</div>
			<div class="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
				<div class="rounded-xl bg-muted/20 px-4 py-2">
					<div class="py-3 border-b border-border/40 space-y-3">
						<Skeleton class="h-4 w-20" />
						<Skeleton class="h-9 w-full" />
					</div>
					<div class="py-3 space-y-2">
						<Skeleton class="h-14 w-full rounded-md" />
						<Skeleton class="h-14 w-full rounded-md" />
						<Skeleton class="h-14 w-full rounded-md" />
					</div>
				</div>
				<div class="rounded-xl bg-muted/20 px-4 py-2">
					<div class="py-3 border-b border-border/40 space-y-2">
						<Skeleton class="h-4 w-48" />
						<Skeleton class="h-3 w-56" />
					</div>
					<div class="py-3 space-y-3">
						<Skeleton class="h-16 w-full rounded-md" />
						<Skeleton class="h-16 w-full rounded-md" />
						<Skeleton class="h-40 w-full rounded-md" />
					</div>
				</div>
			</div>
		</div>
	);
}
