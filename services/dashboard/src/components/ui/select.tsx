import type { SelectContentProps, SelectItemProps, SelectTriggerProps } from "@kobalte/core/select";
import { Select as SelectPrimitive } from "@kobalte/core/select";
import { Check, ChevronDown } from "lucide-solid";
import type { Component, JSX } from "solid-js";
import { splitProps } from "solid-js";

import { cn } from "~/lib/utils/client";

const Select = SelectPrimitive;

const SelectValue = SelectPrimitive.Value;

type SelectTriggerPropsWithClass = SelectTriggerProps & { class?: string; children?: JSX.Element };

const SelectTrigger: Component<SelectTriggerPropsWithClass> = (props) => {
	const [local, others] = splitProps(props, ["class", "children"]);
	return (
		<SelectPrimitive.Trigger
			class={cn(
				"flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-colors placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer hover:bg-accent hover:text-accent-foreground",
				local.class,
			)}
			{...others}
		>
			{local.children}
			<SelectPrimitive.Icon>
				<ChevronDown class="h-4 w-4 opacity-50" />
			</SelectPrimitive.Icon>
		</SelectPrimitive.Trigger>
	);
};

type SelectContentPropsWithClass = SelectContentProps & { class?: string };

const SelectContent: Component<SelectContentPropsWithClass> = (props) => {
	const [local, others] = splitProps(props, ["class"]);
	return (
		<SelectPrimitive.Portal>
			<SelectPrimitive.Content
				class={cn("relative z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md animate-in fade-in-80", local.class)}
				{...others}
			>
				<SelectPrimitive.Listbox class="m-0 p-1" />
			</SelectPrimitive.Content>
		</SelectPrimitive.Portal>
	);
};

type SelectItemPropsWithClass = SelectItemProps & { class?: string; children?: JSX.Element };

const SelectItem: Component<SelectItemPropsWithClass> = (props) => {
	const [local, others] = splitProps(props, ["class", "children"]);
	return (
		<SelectPrimitive.Item
			class={cn(
				"relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
				local.class,
			)}
			{...others}
		>
			<span class="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
				<SelectPrimitive.ItemIndicator>
					<Check class="h-4 w-4" />
				</SelectPrimitive.ItemIndicator>
			</span>
			<SelectPrimitive.ItemLabel>{local.children}</SelectPrimitive.ItemLabel>
		</SelectPrimitive.Item>
	);
};

export { Select, SelectValue, SelectTrigger, SelectContent, SelectItem };
