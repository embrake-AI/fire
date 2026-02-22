import { createFileRoute } from "@tanstack/solid-router";
import { LoaderCircle, Plus, Search, Trash2, Users as UsersIcon } from "lucide-solid";
import { createMemo, createSignal, For, Show, Suspense } from "solid-js";
import { EntityPicker } from "~/components/EntityPicker";
import { UserAvatar } from "~/components/UserAvatar";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Skeleton } from "~/components/ui/skeleton";
import { Switch, SwitchControl, SwitchLabel, SwitchThumb } from "~/components/ui/switch";
import { requireRoutePermission } from "~/lib/auth/route-guards";
import {
	type ManageableUserRole,
	useAddWorkspaceUserFromSlack,
	usePossibleSlackUsers,
	useRemoveWorkspaceUser,
	useUpdateWorkspaceUserProvisioningSettings,
	useUpdateWorkspaceUserRole,
	useWorkspaceUserProvisioningSettings,
	useWorkspaceUsersForManagement,
} from "~/lib/users/users.hooks";

export const Route = createFileRoute("/_authed/settings/workspace/users")({
	beforeLoad: requireRoutePermission("settings.workspace.write"),
	component: WorkspaceUsersPage,
});

const ROLE_OPTIONS: { value: ManageableUserRole; label: string }[] = [
	{ value: "VIEWER", label: "Viewer" },
	{ value: "MEMBER", label: "Member" },
	{ value: "ADMIN", label: "Admin" },
];

type SlackCandidate = {
	id: string;
	name: string;
	avatar?: string;
	type: "slack";
};

function roleLabel(role: ManageableUserRole) {
	return ROLE_OPTIONS.find((option) => option.value === role)?.label ?? "Admin";
}

function WorkspaceUsersPage() {
	return (
		<div class="space-y-8">
			<div>
				<h2 class="text-lg font-semibold text-foreground">User Management</h2>
				<p class="text-sm text-muted-foreground mt-1">Manage workspace user roles and provisioning defaults.</p>
			</div>

			<Suspense fallback={<UserManagementSkeleton />}>
				<UserManagementContent />
			</Suspense>
		</div>
	);
}

function UserManagementContent() {
	const usersQuery = useWorkspaceUsersForManagement();
	const provisioningQuery = useWorkspaceUserProvisioningSettings();
	const updateRoleMutation = useUpdateWorkspaceUserRole();
	const updateProvisioningMutation = useUpdateWorkspaceUserProvisioningSettings();
	const addFromSlackMutation = useAddWorkspaceUserFromSlack();
	const removeWorkspaceUserMutation = useRemoveWorkspaceUser();

	const [pickerOpen, setPickerOpen] = createSignal(false);
	const [userSearchQuery, setUserSearchQuery] = createSignal("");

	const possibleSlackUsers = usePossibleSlackUsers();
	const slackCandidates = createMemo<SlackCandidate[]>(() =>
		possibleSlackUsers()
			.filter((entity) => entity.type === "slack")
			.map((entity) => ({
				id: entity.id,
				name: entity.name,
				avatar: entity.avatar ?? undefined,
				type: "slack" as const,
			})),
	);

	const handleRoleChange = async (userId: string, role: string | null) => {
		if (!role) {
			return;
		}
		await updateRoleMutation.mutateAsync({ userId, role: role as ManageableUserRole });
	};

	const handleDefaultRoleChange = async (role: string | null) => {
		if (!role) {
			return;
		}
		await updateProvisioningMutation.mutateAsync({ defaultUserRole: role as ManageableUserRole });
	};

	const handleAutoCreateToggle = async (enabled: boolean) => {
		await updateProvisioningMutation.mutateAsync({ autoCreateUsersWithSso: enabled });
	};

	const handleAddFromSlack = async (candidate: SlackCandidate) => {
		await addFromSlackMutation.mutateAsync({ slackUserId: candidate.id, name: candidate.name, avatar: candidate.avatar });
		setPickerOpen(false);
	};

	const handleRemoveUser = async (userId: string) => {
		await removeWorkspaceUserMutation.mutateAsync({ userId });
	};

	const filteredUsers = createMemo(() => {
		const query = userSearchQuery().trim().toLowerCase();
		const users = usersQuery.data ?? [];
		if (!query) {
			return users;
		}

		return users.filter((workspaceUser) => workspaceUser.name.toLowerCase().includes(query) || workspaceUser.email.toLowerCase().includes(query));
	});

	return (
		<div class="space-y-6">
			{/* Provisioning defaults */}
			<div class="rounded-xl bg-muted/20 px-4 py-2">
				<div class="divide-y divide-border/40">
					<div class="flex items-center justify-between py-3">
						<p class="text-sm font-medium text-foreground">Default role for new users</p>
						<Select
							options={ROLE_OPTIONS.map((option) => option.value)}
							value={provisioningQuery.data?.defaultUserRole ?? "VIEWER"}
							onChange={(value) => {
								void handleDefaultRoleChange(value);
							}}
							itemComponent={(props) => <SelectItem item={props.item}>{roleLabel(props.item.rawValue as ManageableUserRole)}</SelectItem>}
						>
							<SelectTrigger class="w-32">
								<SelectValue<string>>{(state) => roleLabel((state.selectedOption() ?? "VIEWER") as ManageableUserRole)}</SelectValue>
							</SelectTrigger>
							<SelectContent />
						</Select>
					</div>

					<div class="flex items-center justify-between py-3">
						<div>
							<p class="text-sm font-medium text-foreground">Auto-create users with SSO</p>
							<p class="text-xs text-muted-foreground">New users are provisioned on first sign-in.</p>
						</div>
						<Switch
							checked={provisioningQuery.data?.autoCreateUsersWithSso ?? true}
							onChange={(checked) => {
								void handleAutoCreateToggle(checked);
							}}
							disabled={updateProvisioningMutation.isPending}
							class="flex items-center gap-2"
						>
							<SwitchControl>
								<SwitchThumb />
							</SwitchControl>
							<SwitchLabel>{provisioningQuery.data?.autoCreateUsersWithSso ? "Enabled" : "Disabled"}</SwitchLabel>
						</Switch>
					</div>
				</div>
			</div>

			{/* User list */}
			<div class="rounded-xl bg-muted/20 px-4 py-2">
				<div class="flex items-center justify-between py-3 border-b border-border/40">
					<div class="relative flex-1 max-w-64">
						<Search class="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
						<input
							type="text"
							placeholder="Search users..."
							value={userSearchQuery()}
							onInput={(event) => setUserSearchQuery(event.currentTarget.value)}
							class="flex h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
						/>
					</div>
					<Popover open={pickerOpen()} onOpenChange={setPickerOpen}>
						<PopoverTrigger as={Button} disabled={addFromSlackMutation.isPending || slackCandidates().length === 0}>
							<Show when={addFromSlackMutation.isPending} fallback={<Plus class="w-4 h-4 mr-2" />}>
								<LoaderCircle class="w-4 h-4 animate-spin mr-2" />
							</Show>
							Add from Slack
						</PopoverTrigger>
						<PopoverContent class="p-0" style={{ width: "240px" }}>
							<EntityPicker
								placeholder="Select a Slack user"
								entities={slackCandidates}
								emptyMessage="No Slack users available."
								onSelect={(entity) => {
									void handleAddFromSlack(entity);
								}}
							/>
						</PopoverContent>
					</Popover>
				</div>

				<Show when={(usersQuery.data?.length ?? 0) > 0} fallback={<UsersEmptyState />}>
					<Show when={filteredUsers().length > 0} fallback={<UsersSearchEmptyState />}>
						<div class="divide-y divide-border/40">
							<For each={filteredUsers()}>
								{(workspaceUser) => (
									<div class="py-3 flex items-center justify-between gap-3">
										<div class="flex items-center gap-3 min-w-0">
											<UserAvatar name={() => workspaceUser.name} avatar={() => workspaceUser.image ?? undefined} />
											<div class="min-w-0">
												<p class="text-sm font-medium text-foreground truncate">{workspaceUser.name}</p>
												<p class="text-xs text-muted-foreground truncate">{workspaceUser.email}</p>
											</div>
										</div>

										<div class="flex items-center gap-2 shrink-0">
											<Show when={workspaceUser.isRoleEditable} fallback={<Badge variant="secondary">Admin</Badge>}>
												<Select
													options={ROLE_OPTIONS.map((option) => option.value)}
													value={workspaceUser.role}
													onChange={(value) => {
														void handleRoleChange(workspaceUser.id, value);
													}}
													itemComponent={(props) => <SelectItem item={props.item}>{roleLabel(props.item.rawValue as ManageableUserRole)}</SelectItem>}
												>
													<SelectTrigger class="w-28">
														<SelectValue<string>>{(state) => roleLabel((state.selectedOption() ?? "ADMIN") as ManageableUserRole)}</SelectValue>
													</SelectTrigger>
													<SelectContent />
												</Select>
												<Button
													variant="ghost"
													size="icon"
													class="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
													disabled={removeWorkspaceUserMutation.isPending}
													onClick={() => void handleRemoveUser(workspaceUser.id)}
												>
													<Show
														when={removeWorkspaceUserMutation.isPending && removeWorkspaceUserMutation.variables?.userId === workspaceUser.id}
														fallback={<Trash2 class="w-4 h-4" />}
													>
														<LoaderCircle class="w-4 h-4 animate-spin" />
													</Show>
												</Button>
											</Show>
										</div>
									</div>
								)}
							</For>
						</div>
					</Show>
				</Show>
			</div>
		</div>
	);
}

function UsersEmptyState() {
	return (
		<div class="flex flex-col items-center justify-center py-10">
			<div class="relative mb-3">
				<div class="absolute inset-0 bg-blue-400/20 rounded-full blur-xl animate-pulse" />
				<div class="relative p-3 rounded-full bg-linear-to-br from-blue-100 to-blue-50 border border-blue-200/60">
					<UsersIcon class="w-7 h-7 text-blue-600" />
				</div>
			</div>
			<p class="text-sm font-medium text-foreground">No users found</p>
			<p class="text-xs text-muted-foreground">Use "Add user from Slack" to provision users.</p>
		</div>
	);
}

function UsersSearchEmptyState() {
	return (
		<div class="flex flex-col items-center justify-center py-10">
			<p class="text-sm font-medium text-foreground">No users match your search</p>
			<p class="text-xs text-muted-foreground">Try a different name or email.</p>
		</div>
	);
}

function UserManagementSkeleton() {
	return (
		<div class="space-y-6">
			<div class="rounded-xl bg-muted/20 px-4 py-2">
				<div class="divide-y divide-border/40">
					<div class="flex items-center justify-between py-3">
						<Skeleton class="h-4 w-44" />
						<Skeleton class="h-9 w-32 rounded-md" />
					</div>
					<div class="flex items-center justify-between py-3">
						<Skeleton class="h-4 w-48" />
						<Skeleton class="h-6 w-24 rounded-full" />
					</div>
				</div>
			</div>
			<div class="rounded-xl bg-muted/20 px-4 py-2">
				<div class="flex items-center justify-between py-3 border-b border-border/40">
					<Skeleton class="h-9 w-64 rounded-md" />
					<Skeleton class="h-9 w-32 rounded-md" />
				</div>
				<div class="divide-y divide-border/40">
					<For each={Array.from({ length: 4 })}>
						{() => (
							<div class="flex items-center justify-between py-3">
								<div class="flex items-center gap-3">
									<Skeleton class="size-8 rounded-full" />
									<div class="space-y-1.5">
										<Skeleton class="h-3.5 w-28" />
										<Skeleton class="h-3 w-36" />
									</div>
								</div>
								<Skeleton class="h-6 w-16 rounded-full" />
							</div>
						)}
					</For>
				</div>
			</div>
		</div>
	);
}
