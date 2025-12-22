import type { PopoverContentProps } from "@kobalte/core/popover";
import { Popover as PopoverPrimitive } from "@kobalte/core/popover";
import type { Component, JSX } from "solid-js";
import { splitProps } from "solid-js";

import { cn } from "~/lib/utils";

const Popover = PopoverPrimitive;

const PopoverTrigger = PopoverPrimitive.Trigger;

type PopoverContentPropsWithClass = PopoverContentProps & { class?: string; children?: JSX.Element };

const PopoverContent: Component<PopoverContentPropsWithClass> = (props) => {
	const [local, others] = splitProps(props, ["class"]);
	return (
		<PopoverPrimitive.Portal>
			<PopoverPrimitive.Content
				class={cn(
					"z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
					local.class,
				)}
				{...others}
			/>
		</PopoverPrimitive.Portal>
	);
};

export { Popover, PopoverTrigger, PopoverContent };
