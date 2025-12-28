import { Check } from "lucide-solid";
import { createMemo, For, onMount, Show, Suspense } from "solid-js";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "~/components/ui/command";
import { Skeleton } from "~/components/ui/skeleton";
import type { SlackUser } from "~/lib/slack";
import { useSlackUser } from "~/lib/useSlackUser";
import { useSlackUsers } from "~/lib/useSlackUsers";

export type SlackEntity = { type: "user"; id: string; name?: string; avatar?: string };

interface SlackEntityPickerProps {
	/** Called when an entity is selected */
	onSelect: (entity: SlackEntity) => void;
	/** IDs of entities to exclude from the list */
	excludeId?: (id: string) => boolean;
	/** Currently selected entity ID (shows checkmark) */
	selectedId?: string;
	/** Placeholder text for search input */
	placeholder: string;
	/** Whether to show both users and groups, or just one type */
	mode?: "all" | "users" | "groups";
	/** Custom empty state message */
	emptyMessage?: string;
	/** Whether the picker is disabled */
	disabled?: boolean;
}

export function SlackEntityPicker(props: SlackEntityPickerProps) {
	const placeholder = () => props.placeholder;
	let containerRef: HTMLDivElement | undefined;

	onMount(() => {
		containerRef?.querySelector("input")?.focus();
	});

	return (
		<div ref={containerRef}>
			<Command>
				<CommandInput placeholder={placeholder()} />
				<CommandList>
					<Suspense fallback={<EntityListSkeleton />}>
						<EntityList {...props} />
					</Suspense>
				</CommandList>
			</Command>
		</div>
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

	const slackUsersQuery = useSlackUsers();

	const filteredUsers = createMemo(() => {
		if (mode() === "groups") return [];
		return (slackUsersQuery.data ?? []).filter((u) => !props.excludeId?.(u.id));
	});

	const hasResults = () => filteredUsers().length > 0;

	return (
		<div>
			<Show when={hasResults()} fallback={<CommandEmpty>{emptyMessage()}</CommandEmpty>}>
				<Show when={filteredUsers().length > 0}>
					<CommandGroup heading={mode() === "all" ? "Users" : undefined}>
						<For each={filteredUsers()}>{(user) => <EntityRow user={user} onSelect={props.onSelect} selected={props.selectedId === user.id} disabled={props.disabled} />}</For>
					</CommandGroup>
				</Show>
			</Show>
		</div>
	);
}

function EntityRow(props: { user: SlackUser; onSelect: SlackEntityPickerProps["onSelect"]; selected?: boolean; disabled?: boolean }) {
	return (
		<CommandItem
			value={`${props.user.id} ${props.user.name} ${props.user.email}`}
			onSelect={() => props.onSelect({ type: "user", id: props.user.id, name: props.user.name, avatar: props.user.avatar })}
			disabled={props.disabled}
		>
			<div class="flex items-center gap-3 w-full">
				<UserAvatar id={props.user.id} />
				<div class="flex-1 min-w-0">
					<div class="text-sm font-medium">{props.user.name}</div>
					<div class="text-xs text-muted-foreground truncate">{props.user.email}</div>
				</div>
				<Show when={props.selected}>
					<Check class="h-4 w-4 text-primary" />
				</Show>
			</div>
		</CommandItem>
	);
}

export function UserAvatar(props: { id: string; withName?: boolean }) {
	const user = useSlackUser(() => props.id);

	const name = () => user()?.name ?? "Unknown";
	const avatar = () => user()?.avatar;

	const initials = () =>
		name()
			.split(" ")
			.map((n) => n[0])
			.join("")
			.slice(0, 2);

	return (
		<Show when={avatar()} fallback={<div class="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-600 font-medium text-sm">{initials()}</div>}>
			<img src={avatar()} alt={name()} class="w-8 h-8 rounded-full object-cover shrink-0" />
			<Show when={props.withName && name()}>
				<div class="flex flex-col">
					<span class="truncate">{name()}</span>
				</div>
			</Show>
		</Show>
	);
}
