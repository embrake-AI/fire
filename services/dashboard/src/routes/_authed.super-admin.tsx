import { createFileRoute } from "@tanstack/solid-router";
import { Building2, LoaderCircle, Search, Shield, Users } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Show, Suspense } from "solid-js";
import { UserAvatar } from "~/components/UserAvatar";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { requireRoutePermission } from "~/lib/auth/route-guards";
import { useStartImpersonating, useSuperAdminClients, useSuperAdminClientUsers } from "~/lib/auth/super-admin.hooks";
import { cn } from "~/lib/utils/client";

export const Route = createFileRoute("/_authed/super-admin")({
	beforeLoad: requireRoutePermission("impersonation.write"),
	component: SuperAdminPage,
});

function SuperAdminPage() {
	return (
		<div class="flex-1 bg-background px-6 py-12 md:px-8 md:py-16">
			<div class="max-w-6xl mx-auto space-y-8 h-full min-h-0">
				<div>
					<h2 class="text-lg font-semibold text-foreground">Super Admin</h2>
					<p class="text-sm text-muted-foreground mt-1">Browse clients and impersonate their users.</p>
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
	const [clientSearchQuery, setClientSearchQuery] = createSignal("");
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

	const usersQuery = useSuperAdminClientUsers(selectedClientId);

	const filteredClients = createMemo(() => {
		const query = clientSearchQuery().trim().toLowerCase();
		const clients = clientsQuery.data ?? [];
		if (!query) {
			return clients;
		}

		return clients.filter((workspaceClient) => {
			const matchesName = workspaceClient.name.toLowerCase().includes(query);
			const matchesDomain = (workspaceClient.domains ?? []).some((domain) => domain.toLowerCase().includes(query));
			return matchesName || matchesDomain;
		});
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

	const handleImpersonate = async (userId: string) => {
		await startImpersonatingMutation.mutateAsync({ userId });
		window.location.assign("/");
	};

	return (
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
							value={clientSearchQuery()}
							onInput={(event) => setClientSearchQuery(event.currentTarget.value)}
							class="flex h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
						/>
					</div>
				</div>
				<div class="py-3 overflow-y-auto min-h-0 pr-2">
					<Show when={(filteredClients().length ?? 0) > 0} fallback={<p class="text-sm text-muted-foreground">No clients found.</p>}>
						<div class="space-y-1">
							<For each={filteredClients()}>
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
	);
}

function SuperAdminSkeleton() {
	return (
		<div class="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)] min-h-0">
			<div class="rounded-xl bg-muted/20 px-4 py-2 max-h-[70vh] overflow-hidden flex flex-col min-h-0">
				<div class="py-3 border-b border-border/40 space-y-3 shrink-0">
					<Skeleton class="h-4 w-20" />
					<Skeleton class="h-9 w-full" />
				</div>
				<div class="py-3 space-y-2 overflow-y-auto min-h-0 pr-2">
					<Skeleton class="h-14 w-full rounded-md" />
					<Skeleton class="h-14 w-full rounded-md" />
					<Skeleton class="h-14 w-full rounded-md" />
				</div>
			</div>
			<div class="rounded-xl bg-muted/20 px-4 py-2 max-h-[70vh] overflow-hidden flex flex-col min-h-0">
				<div class="py-3 border-b border-border/40 space-y-3 shrink-0">
					<Skeleton class="h-4 w-40" />
					<Skeleton class="h-9 w-full" />
				</div>
				<div class="py-3 space-y-3 overflow-y-auto min-h-0 pr-2">
					<Skeleton class="h-14 w-full rounded-md" />
					<Skeleton class="h-14 w-full rounded-md" />
					<Skeleton class="h-14 w-full rounded-md" />
				</div>
			</div>
		</div>
	);
}
