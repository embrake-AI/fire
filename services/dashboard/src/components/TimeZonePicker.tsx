import { Check, ChevronDown, LoaderCircle } from "lucide-solid";
import { createMemo, createSignal, For, Show } from "solid-js";
import { Button } from "~/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "~/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { formatRotationTimeZoneLabel, getSupportedRotationTimeZones } from "~/lib/rotations/rotation-timezone";
import { cn } from "~/lib/utils/client";

type TimeZonePickerProps = {
	value?: string | null;
	disabled?: boolean;
	isSaving?: boolean;
	triggerClass?: string;
	onChange: (value: string) => void;
};

const TIME_ZONES = getSupportedRotationTimeZones();

function normalizeSearchText(value: string) {
	return value.toLowerCase().replaceAll("_", " ").replaceAll("/", " ").trim();
}

function tokenizeSearchText(value: string) {
	return normalizeSearchText(value)
		.split(/\s+/)
		.map((token) => token.trim())
		.filter(Boolean);
}

function matchesTimeZone(timeZone: string, query: string) {
	const normalizedQuery = normalizeSearchText(query);
	if (!normalizedQuery) {
		return true;
	}

	const candidateTokens = tokenizeSearchText(timeZone);
	const queryTokens = tokenizeSearchText(query);

	return queryTokens.every((queryToken) => candidateTokens.some((candidateToken) => candidateToken.includes(queryToken)));
}

export function TimeZonePicker(props: TimeZonePickerProps) {
	const [open, setOpen] = createSignal(false);
	const [query, setQuery] = createSignal("");

	const selectedTimeZone = createMemo(() => props.value ?? "UTC");
	const triggerLabel = createMemo(() => formatRotationTimeZoneLabel(selectedTimeZone()));

	const handleSelect = (value: string) => {
		props.onChange(value);
		setQuery("");
		setOpen(false);
	};

	return (
		<Popover
			open={open()}
			onOpenChange={(nextOpen) => {
				setOpen(nextOpen);
				if (!nextOpen) {
					setQuery("");
				}
			}}
		>
			<PopoverTrigger
				as={Button}
				variant="outline"
				size="sm"
				type="button"
				disabled={props.disabled}
				class={cn("h-8 min-w-[12rem] max-w-[16rem] justify-between gap-2 border-border bg-transparent px-3 text-xs font-medium hover:bg-muted/50", props.triggerClass)}
			>
				<span class={cn("min-w-0 flex-1 truncate text-left", !props.value && "text-muted-foreground")}>{triggerLabel()}</span>
				<Show when={props.isSaving} fallback={<ChevronDown class="h-3 w-3 shrink-0 opacity-50" />}>
					<LoaderCircle class="h-3 w-3 shrink-0 animate-spin" />
				</Show>
			</PopoverTrigger>
			<PopoverContent class="w-[20rem] p-0">
				<Command filter={(value, search) => (matchesTimeZone(value, search) ? 1 : 0)}>
					<CommandInput value={query()} onValueChange={setQuery} placeholder="Search time zones..." />
					<CommandList class="max-h-[260px]">
						<CommandEmpty>No time zones found.</CommandEmpty>
						<For each={TIME_ZONES}>
							{(timeZone) => (
								<CommandItem value={timeZone} onSelect={() => handleSelect(timeZone)}>
									<div class="flex w-full items-center gap-2">
										<div class="min-w-0 flex-1 truncate text-sm">{formatRotationTimeZoneLabel(timeZone)}</div>
										<Show when={selectedTimeZone() === timeZone}>
											<Check class="h-4 w-4 text-primary" />
										</Show>
									</div>
								</CommandItem>
							)}
						</For>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
