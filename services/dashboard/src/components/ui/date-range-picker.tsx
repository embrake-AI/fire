import { DatePicker, type DateValue } from "@ark-ui/solid/date-picker";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-solid";
import type { Component } from "solid-js";
import { createMemo, createSignal, For, Match, onMount, Switch, splitProps } from "solid-js";
import { Portal } from "solid-js/web";

import { cn } from "~/lib/utils/client";

type PresetKey = "last3Days" | "thisWeek" | "thisMonth" | "thisYear" | "last30Days";

type Preset = {
	key: PresetKey;
	label: string;
};

const PRESETS: Preset[] = [
	{ key: "thisWeek", label: "This Week" },
	{ key: "last30Days", label: "Last 30 Days" },
	{ key: "thisMonth", label: "This Month" },
	{ key: "thisYear", label: "This Year" },
];

export interface DateRangePickerProps {
	/** Controlled value (range mode expects 0..2 values: [start, end]) */
	value?: DateValue[];
	/** Uncontrolled initial value */
	defaultValue?: DateValue[];
	/** Called when the selection changes */
	onValueChange?: (value: DateValue[]) => void;

	label?: string;
	disabled?: boolean;
	min?: DateValue;
	max?: DateValue;
	class?: string;
	defaultPreset?: PresetKey;
}

export const DateRangePicker: Component<DateRangePickerProps> = (props) => {
	const [local, rootProps] = splitProps(props, ["value", "defaultValue", "onValueChange", "label", "disabled", "min", "max", "class", "defaultPreset"]);

	const isControlled = () => local.value !== undefined;
	const [uncontrolled, setUncontrolled] = createSignal<DateValue[]>(local.defaultValue ?? []);

	const value = () => (isControlled() ? (local.value ?? []) : uncontrolled());

	const setValue = (next: DateValue[]) => {
		if (!isControlled()) setUncontrolled(next);
		local.onValueChange?.(next);
	};

	return (
		<DatePicker.Root
			// Range selection: selectionMode="range"
			selectionMode="range"
			value={value()}
			onValueChange={(e) => setValue(e.value)}
			disabled={local.disabled}
			min={local.min}
			max={local.max}
			{...rootProps}
			class={cn("w-fit", local.class)}
		>
			<DatePicker.Context>
				{(api) => {
					onMount(() => {
						if (local.defaultPreset && value().length === 0) {
							const preset = api().getRangePresetValue(local.defaultPreset);
							if (preset) setValue(preset);
						}
					});
					return null;
				}}
			</DatePicker.Context>
			{local.label && <DatePicker.Label class="mb-2 block text-sm font-medium">{local.label}</DatePicker.Label>}

			<DatePicker.Control class="flex items-center bg-muted/40 rounded-xl px-1.5 py-1.5 gap-2 w-fit">
				<DatePicker.Trigger
					class={cn(
						"inline-flex h-9 items-center justify-center rounded-lg border bg-background px-3 text-sm font-semibold shadow-sm transition-all",
						"hover:bg-accent hover:text-accent-foreground",
						"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
						"disabled:pointer-events-none disabled:opacity-50",
						"flex items-center gap-2 min-w-[150px] cursor-pointer",
					)}
				>
					<DatePicker.Context>
						{(api) => {
							const activePreset = createMemo(() => {
								const current = api().value ?? [];
								if (current.length !== 2) return undefined;

								return PRESETS.find((p) => {
									const preset = api().getRangePresetValue(p.key) ?? [];
									return preset.length === 2 && String(preset[0]) === String(current[0]) && String(preset[1]) === String(current[1]);
								});
							});

							return <span>{activePreset()?.label ?? "Custom"}</span>;
						}}
					</DatePicker.Context>
					<ChevronDown class="size-4 opacity-50" />
				</DatePicker.Trigger>

				<div class="px-2 text-sm font-medium text-muted-foreground/80 flex items-center gap-1.5">
					<DatePicker.Context>
						{(api) => {
							const label = createMemo(() => {
								const range = api().value;
								if (range.length === 0) return null;
								if (range.length === 1) return { start: String(range[0]), end: null };
								return { start: String(range[0]), end: String(range[1]) };
							});

							return (
								<Switch>
									<Match when={!label()}>
										<span>Select range</span>
									</Match>

									<Match when={label() && !label()!.end}>
										<span>{label()!.start}</span>
									</Match>

									<Match when={label()!.end}>
										<span>{label()!.start}</span>
										<span class="opacity-40">-</span>
										<span>{label()!.end}</span>
									</Match>
								</Switch>
							);
						}}
					</DatePicker.Context>
				</div>
			</DatePicker.Control>

			<Portal>
				<DatePicker.Positioner class="z-50">
					<DatePicker.Content class={cn("mt-2 rounded-md border bg-popover p-3 text-popover-foreground shadow-md outline-none")}>
						<div class="flex flex-col gap-4 sm:flex-row">
							{/* Presets */}
							<div class="grid gap-1 sm:w-[140px]">
								<div class="px-2 pb-1 text-xs font-medium text-muted-foreground">Presets</div>
								<DatePicker.Context>
									{(api) => (
										<For each={PRESETS}>
											{(preset) => {
												return (
													<DatePicker.PresetTrigger
														value={preset.key}
														class={cn(
															"h-9 justify-start px-2 inline-flex items-center rounded-md text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground cursor-pointer outline-none",
															JSON.stringify(api().getRangePresetValue(preset.key)) === JSON.stringify(value()) && "bg-accent text-accent-foreground",
														)}
													>
														{preset.label}
													</DatePicker.PresetTrigger>
												);
											}}
										</For>
									)}
								</DatePicker.Context>
							</div>

							{/* Calendar */}
							<div>
								<DatePicker.View view="day">
									<DatePicker.Context>
										{(api) => (
											<>
												<DatePicker.ViewControl class="mb-2 flex items-center justify-between gap-2">
													<DatePicker.PrevTrigger
														class={cn(
															"inline-flex size-9 items-center justify-center rounded-md border bg-background shadow-sm transition-colors",
															"hover:bg-accent hover:text-accent-foreground",
															"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
															"disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
														)}
													>
														<ChevronLeft class="size-4" />
														<span class="sr-only">Previous</span>
													</DatePicker.PrevTrigger>

													<DatePicker.ViewTrigger class="flex-1 rounded-md px-2 py-1 text-center text-sm font-medium">
														<DatePicker.RangeText />
													</DatePicker.ViewTrigger>

													<DatePicker.NextTrigger
														class={cn(
															"inline-flex size-9 items-center justify-center rounded-md border bg-background shadow-sm transition-colors",
															"hover:bg-accent hover:text-accent-foreground",
															"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
															"disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
														)}
													>
														<ChevronRight class="size-4" />
														<span class="sr-only">Next</span>
													</DatePicker.NextTrigger>
												</DatePicker.ViewControl>

												<DatePicker.Table class="w-full border-collapse">
													<DatePicker.TableHead>
														<DatePicker.TableRow>
															<For each={api().weekDays}>
																{(weekDay) => (
																	<DatePicker.TableHeader class="w-9 p-0 pb-1 text-center text-xs font-normal text-muted-foreground">{weekDay.short}</DatePicker.TableHeader>
																)}
															</For>
														</DatePicker.TableRow>
													</DatePicker.TableHead>

													<DatePicker.TableBody>
														<For each={api().weeks}>
															{(week) => (
																<DatePicker.TableRow>
																	<For each={week}>
																		{(day) => (
																			<DatePicker.TableCell value={day} class="p-0 text-center">
																				<DatePicker.TableCellTrigger
																					class={cn(
																						"inline-flex size-9 items-center justify-center rounded-md text-sm outline-none transition-colors",
																						"hover:bg-accent hover:text-accent-foreground",
																						"focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
																						"data-[disabled]:pointer-events-none data-[disabled]:opacity-50 cursor-pointer",
																						"data-[selected]:bg-primary data-[selected]:text-primary-foreground",
																						"data-[in-range]:bg-accent data-[in-range]:text-accent-foreground",
																						"data-[range-start]:rounded-l-md data-[range-end]:rounded-r-md",
																					)}
																				>
																					{day.day}
																				</DatePicker.TableCellTrigger>
																			</DatePicker.TableCell>
																		)}
																	</For>
																</DatePicker.TableRow>
															)}
														</For>
													</DatePicker.TableBody>
												</DatePicker.Table>
											</>
										)}
									</DatePicker.Context>
								</DatePicker.View>
							</div>
						</div>
					</DatePicker.Content>
				</DatePicker.Positioner>
			</Portal>
		</DatePicker.Root>
	);
};
