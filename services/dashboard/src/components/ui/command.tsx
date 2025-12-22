import { Command as CommandPrimitive } from "cmdk-solid";
import { Search } from "lucide-solid";
import type { Component, ComponentProps } from "solid-js";
import { splitProps } from "solid-js";

import { cn } from "~/lib/utils";

const Command: Component<ComponentProps<typeof CommandPrimitive>> = (props) => {
	const [local, others] = splitProps(props, ["class"]);
	return <CommandPrimitive class={cn("flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground", local.class)} {...others} />;
};

const CommandList: Component<ComponentProps<typeof CommandPrimitive.List>> = (props) => {
	const [local, others] = splitProps(props, ["class"]);
	return <CommandPrimitive.List class={cn("max-h-[300px] overflow-y-auto overflow-x-hidden", local.class)} {...others} />;
};

const CommandInput: Component<ComponentProps<typeof CommandPrimitive.Input>> = (props) => {
	const [local, others] = splitProps(props, ["class"]);
	return (
		<div class="flex items-center border-b px-3" cmdk-input-wrapper="">
			<Search class="mr-2 h-4 w-4 shrink-0 opacity-50" />
			<CommandPrimitive.Input
				class={cn(
					"flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
					local.class,
				)}
				{...others}
			/>
		</div>
	);
};

const CommandItem: Component<ComponentProps<typeof CommandPrimitive.Item>> = (props) => {
	const [local, others] = splitProps(props, ["class"]);
	return (
		<CommandPrimitive.Item
			class={cn(
				"relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none aria-selected:bg-accent aria-selected:text-accent-foreground data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
				local.class,
			)}
			{...others}
		/>
	);
};

const CommandEmpty: Component<ComponentProps<typeof CommandPrimitive.Empty>> = (props) => <CommandPrimitive.Empty class="py-6 text-center text-sm" {...props} />;

const CommandGroup: Component<ComponentProps<typeof CommandPrimitive.Group>> = (props) => {
	const [local, others] = splitProps(props, ["class"]);
	return (
		<CommandPrimitive.Group
			class={cn(
				"overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground",
				local.class,
			)}
			{...others}
		/>
	);
};

export { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem };
