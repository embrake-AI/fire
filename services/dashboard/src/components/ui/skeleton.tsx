import type { Component, ComponentProps } from "solid-js";
import { splitProps } from "solid-js";
import { cn } from "~/lib/utils/client";

export interface SkeletonProps extends ComponentProps<"div"> {
	variant?: "text" | "circular" | "rectangular";
}

export const Skeleton: Component<SkeletonProps> = (props) => {
	const [local, rest] = splitProps(props, ["class", "variant"]);

	return (
		<div
			class={cn(
				"bg-muted/50 animate-pulse animate-infinite",
				local.variant === "circular" && "rounded-full",
				local.variant === "text" && "rounded h-4",
				(!local.variant || local.variant === "rectangular") && "rounded-md",
				local.class,
			)}
			{...rest}
		/>
	);
};
