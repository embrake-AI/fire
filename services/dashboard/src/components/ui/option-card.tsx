import type { Component, JSX } from "solid-js";
import { Show, splitProps } from "solid-js";

import { cn } from "~/lib/utils/client";

interface OptionCardProps {
	icon: JSX.Element;
	title: string;
	description?: string;
	detail?: JSX.Element;
	onClick: () => void;
	disabled?: boolean;
	/** Pass complete Tailwind hover classes, e.g. "hover:border-blue-300" */
	hoverClass?: string;
	layout?: "vertical" | "horizontal";
	class?: string;
}

const OptionCard: Component<OptionCardProps> = (props) => {
	const [local, others] = splitProps(props, ["icon", "title", "description", "detail", "onClick", "disabled", "hoverClass", "layout", "class"]);

	const isVertical = () => local.layout === "vertical";

	return (
		<button
			type="button"
			onClick={local.onClick}
			disabled={local.disabled}
			class={cn(
				"flex items-center gap-3 rounded-lg border border-border bg-background transition-colors cursor-pointer",
				"hover:bg-muted/50 disabled:opacity-50 disabled:cursor-not-allowed",
				isVertical() ? "flex-col p-4 gap-2" : "w-full p-3",
				local.hoverClass,
				local.class,
			)}
			{...others}
		>
			{local.icon}
			<div class={cn("min-w-0", isVertical() ? "text-center" : "flex-1 text-left")}>
				<div class="text-sm font-medium">{local.title}</div>
				<Show when={local.description}>
					<div class="text-xs text-muted-foreground">{local.description}</div>
				</Show>
			</div>
			<Show when={local.detail}>{local.detail}</Show>
		</button>
	);
};

export { OptionCard };
export type { OptionCardProps };
