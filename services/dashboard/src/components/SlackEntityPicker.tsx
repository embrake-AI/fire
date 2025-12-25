import { useQuery } from "@tanstack/solid-query";
import { Check, UsersRound } from "lucide-solid";
import { createMemo, For, Show, Suspense } from "solid-js";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "~/components/ui/command";
import { Skeleton } from "~/components/ui/skeleton";
import type { SlackUser, SlackUserGroup } from "~/lib/entry-points";
import { getSlackUserGroups, getSlackUsers } from "~/lib/entry-points";

export type SlackEntity = { type: "user"; data: SlackUser } | { type: "group"; data: SlackUserGroup };

interface SlackEntityPickerProps {
	/** Called when an entity is selected */
	onSelect: (entity: SlackEntity) => void;
	/** IDs of entities to exclude from the list */
	excludeId?: (id: string) => boolean;
	/** Currently selected entity ID (shows checkmark) */
	selectedId?: string;
	/** Placeholder text for search input */
	placeholder?: string;
	/** Whether to show both users and groups, or just one type */
	mode?: "all" | "users" | "groups";
	/** Custom empty state message */
	emptyMessage?: string;
	/** Whether the picker is disabled */
	disabled?: boolean;
}

export function SlackEntityPicker(props: SlackEntityPickerProps) {
	const placeholder = () => props.placeholder ?? "Search users or groups...";

	return (
		<Command>
			<CommandInput placeholder={placeholder()} />
			<CommandList>
				<Suspense fallback={<EntityListSkeleton />}>
					<EntityList {...props} />
				</Suspense>
			</CommandList>
		</Command>
	);
}

function EntityListSkeleton() {
	return (
		<div class="p-2 space-y-2">
			<For each={[1, 2, 3]}>
				{() => (
					<div class="flex items-center gap-3 p-2">
						<Skeleton variant="circular" class="w-8 h-8" />
						<div class="flex-1 space-y-1.5">
							<Skeleton variant="text" class="h-4 w-24" />
							<Skeleton variant="text" class="h-3 w-32" />
						</div>
					</div>
				)}
			</For>
		</div>
	);
}

function EntityList(props: SlackEntityPickerProps) {
	const mode = () => props.mode ?? "all";
	const emptyMessage = () => props.emptyMessage ?? "No results found.";

	const slackUsersQuery = useQuery(() => ({
		queryKey: ["slack-users"],
		queryFn: getSlackUsers,
		enabled: mode() === "all" || mode() === "users",
		staleTime: Infinity,
	}));

	const slackGroupsQuery = useQuery(() => ({
		queryKey: ["slack-groups"],
		queryFn: getSlackUserGroups,
		enabled: mode() === "all" || mode() === "groups",
		staleTime: Infinity,
	}));

	const filteredUsers = createMemo(() => {
		if (mode() === "groups") return [];
		return (slackUsersQuery.data ?? []).filter((u) => !props.excludeId?.(u.id));
	});

	const filteredGroups = createMemo(() => {
		if (mode() === "users") return [];
		return (slackGroupsQuery.data ?? []).filter((g) => !props.excludeId?.(g.id));
	});

	const hasResults = () => filteredUsers().length > 0 || filteredGroups().length > 0;

	return (
		<div>
			<Show when={hasResults()} fallback={<CommandEmpty>{emptyMessage()}</CommandEmpty>}>
				<Show when={filteredUsers().length > 0}>
					<CommandGroup heading={mode() === "all" ? "Users" : undefined}>
						<For each={filteredUsers()}>
							{(user) => (
								<CommandItem value={`${user.name} ${user.email}`} onSelect={() => props.onSelect({ type: "user", data: user })} disabled={props.disabled}>
									<div class="flex items-center gap-3 w-full">
										<UserAvatar name={user.name} />
										<div class="flex-1 min-w-0">
											<div class="text-sm font-medium">{user.name}</div>
											<div class="text-xs text-muted-foreground truncate">{user.email}</div>
										</div>
										<Show when={props.selectedId === user.id}>
											<Check class="h-4 w-4 text-primary" />
										</Show>
									</div>
								</CommandItem>
							)}
						</For>
					</CommandGroup>
				</Show>

				<Show when={filteredGroups().length > 0}>
					<CommandGroup heading={mode() === "all" ? "Groups" : undefined}>
						<For each={filteredGroups()}>
							{(group) => (
								<CommandItem value={`${group.name} ${group.handle}`} onSelect={() => props.onSelect({ type: "group", data: group })} disabled={props.disabled}>
									<div class="flex items-center gap-3 w-full">
										<div class="flex items-center justify-center w-8 h-8 rounded-full bg-emerald-100 text-emerald-600">
											<UsersRound class="w-4 h-4" />
										</div>
										<div class="flex-1 min-w-0">
											<div class="text-sm font-medium">{group.name}</div>
											<div class="text-xs text-muted-foreground truncate">
												@{group.handle} · {group.memberCount} members
											</div>
										</div>
										<Show when={props.selectedId === group.id}>
											<Check class="h-4 w-4 text-primary" />
										</Show>
									</div>
								</CommandItem>
							)}
						</For>
					</CommandGroup>
				</Show>
			</Show>
		</div>
	);
}

function UserAvatar(props: { name: string }) {
	const initials = () =>
		props.name
			.split(" ")
			.map((n) => n[0])
			.join("")
			.slice(0, 2);

	return <div class="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-600 font-medium text-sm">{initials()}</div>;
}
