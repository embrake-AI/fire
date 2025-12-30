import { Check } from "lucide-solid";
import type { Accessor } from "solid-js";
import { createMemo, For, onMount, Show } from "solid-js";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "~/components/ui/command";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { UserAvatar } from "./UserAvatar";

export type Entity = { id: string; name: string; avatar?: string | null; disabled?: boolean; disabledReason?: string };

interface EntityPickerProps {
	/** Called when an entity is selected */
	onSelect: (entity: Entity) => void;
	/** List of entities to choose from */
	entities: Accessor<Entity[]>;
	/** IDs of entities to exclude from the list */
	excludeId?: (id: string) => boolean;
	/** Currently selected entity ID (shows checkmark) */
	selectedId?: string;
	/** Placeholder text for search input */
	placeholder: string;
	/** Custom empty state message */
	emptyMessage?: string;
	/** Whether the picker is disabled */
	disabled?: boolean;
}

export function EntityPicker(props: EntityPickerProps) {
	const placeholder = () => props.placeholder;
	let containerRef: HTMLDivElement | undefined;

	onMount(() => {
		containerRef?.querySelector("input")?.focus();
	});

	const filteredEntities = createMemo(() => {
		return props.entities()?.filter((e) => !props.excludeId?.(e.id)) ?? [];
	});

	const hasResults = () => filteredEntities().length > 0;
	const emptyMessage = () => props.emptyMessage ?? "No results found.";

	return (
		<div ref={containerRef}>
			<Command>
				<CommandInput placeholder={placeholder()} />
				<CommandList>
					<Show when={hasResults()} fallback={<CommandEmpty>{emptyMessage()}</CommandEmpty>}>
						<CommandGroup>
							<For each={filteredEntities()}>
								{(entity) => <EntityRow entity={entity} onSelect={props.onSelect} selected={props.selectedId === entity.id} disabled={props.disabled} />}
							</For>
						</CommandGroup>
					</Show>
				</CommandList>
			</Command>
		</div>
	);
}

function EntityRow(props: { entity: Entity; onSelect: EntityPickerProps["onSelect"]; selected?: boolean; disabled?: boolean }) {
	const isDisabled = () => props.disabled || props.entity.disabled;

	const content = (
		<CommandItem
			value={`${props.entity.id} ${props.entity.name}`}
			onSelect={() => !isDisabled() && props.onSelect(props.entity)}
			disabled={isDisabled()}
			class={isDisabled() ? "opacity-50" : ""}
		>
			<div class="flex items-center gap-3 w-full">
				<UserAvatar name={() => props.entity.name} avatar={() => props.entity.avatar ?? undefined} />
				<div class="flex-1 min-w-0">
					<div class="text-sm font-medium">{props.entity.name}</div>
				</div>
				<Show when={props.selected}>
					<Check class="h-4 w-4 text-primary" />
				</Show>
			</div>
		</CommandItem>
	);

	return (
		<Show when={isDisabled() && props.entity.disabledReason} fallback={content}>
			<Tooltip>
				<TooltipTrigger as="div" class="w-full">
					{content}
				</TooltipTrigger>
				<TooltipContent>{props.entity.disabledReason}</TooltipContent>
			</Tooltip>
		</Show>
	);
}
