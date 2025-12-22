import type { Component, JSX } from "solid-js";
import { splitProps } from "solid-js";

import { cn } from "~/lib/utils/client";

const Label: Component<JSX.LabelHTMLAttributes<HTMLLabelElement> & { class?: string }> = (props) => {
	const [local, others] = splitProps(props, ["class"]);
	// biome-ignore lint/a11y/noLabelWithoutControl: htmlFor is passed via {...others} by consumers
	return <label class={cn("text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70", local.class)} {...others} />;
};

export { Label };
