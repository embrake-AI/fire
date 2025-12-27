import { LoaderCircle, Trash2 } from "lucide-solid";
import type { JSX } from "solid-js";
import { Show } from "solid-js";
import { cn } from "~/lib/utils/client";
import { Button } from "./button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

// --- ConfigCard ---

interface ConfigCardProps {
	/** Additional classes for the card wrapper */
	class?: string;
	/** Whether the card is in an expanded/active state */
	isActive?: boolean;
	/** Whether the card has a warning/incomplete state */
	hasWarning?: boolean;
	/** Named group for nested cards (e.g., "assignee" creates group/assignee) */
	groupName?: string;
	/** Card content */
	children: JSX.Element;
}

export function ConfigCard(props: ConfigCardProps) {
	const groupClass = () => (props.groupName ? `group/${props.groupName}` : "group");

	return (
		<div
			class={cn(
				groupClass(),
				"border rounded-lg transition-colors overflow-hidden",
				props.hasWarning ? "border-amber-300 bg-amber-50/50 hover:bg-amber-50/70" : "border-border bg-muted/30 hover:bg-muted/50",
				props.isActive && !props.hasWarning && "bg-muted/50",
				props.class,
			)}
		>
			{props.children}
		</div>
	);
}

// --- ConfigCardRow ---

interface ConfigCardRowProps {
	/** Make the row clickable */
	onClick?: () => void;
	/** Additional classes */
	class?: string;
	/** Row content */
	children: JSX.Element;
}

export function ConfigCardRow(props: ConfigCardRowProps) {
	const baseClass = "flex w-full items-center gap-3 p-4";

	return (
		<Show when={props.onClick} fallback={<div class={cn(baseClass, props.class)}>{props.children}</div>}>
			<button type="button" class={cn(baseClass, "text-left cursor-pointer", props.class)} onClick={props.onClick}>
				{props.children}
			</button>
		</Show>
	);
}

// --- ConfigCardIcon ---

interface ConfigCardIconProps {
	/** Icon color variant */
	variant?: "blue" | "violet" | "emerald" | "amber" | "slate";
	/** Size variant */
	size?: "sm" | "md";
	/** Icon content */
	children: JSX.Element;
}

const iconVariants = {
	blue: "bg-blue-100 text-blue-600",
	violet: "bg-violet-100 text-violet-600",
	emerald: "bg-emerald-100 text-emerald-600",
	amber: "bg-amber-100 text-amber-600",
	slate: "bg-slate-100 text-slate-600",
} as const;

export function ConfigCardIcon(props: ConfigCardIconProps) {
	const variant = () => props.variant ?? "blue";

	return <span class={cn("flex items-center justify-center rounded-full shrink-0", "w-8 h-8", iconVariants[variant()])}>{props.children}</span>;
}

// --- ConfigCardContent ---

interface ConfigCardContentProps {
	/** Additional classes */
	class?: string;
	/** Content */
	children: JSX.Element;
}

export function ConfigCardContent(props: ConfigCardContentProps) {
	return <div class={cn("flex-1 min-w-0", props.class)}>{props.children}</div>;
}

// --- ConfigCardTitle ---

interface ConfigCardTitleProps {
	/** Additional classes */
	class?: string;
	/** Title content */
	children: JSX.Element;
}

export function ConfigCardTitle(props: ConfigCardTitleProps) {
	return <span class={cn("text-sm font-medium", props.class)}>{props.children}</span>;
}

// --- ConfigCardDescription ---

interface ConfigCardDescriptionProps {
	/** Additional classes */
	class?: string;
	/** Description content */
	children: JSX.Element;
}

export function ConfigCardDescription(props: ConfigCardDescriptionProps) {
	return <span class={cn("block text-xs text-muted-foreground mt-0.5", props.class)}>{props.children}</span>;
}

// --- ConfigCardActions ---

interface ConfigCardActionsProps {
	/** Whether to always show actions (not just on hover) */
	alwaysVisible?: boolean;
	/** Use slide-in animation on hover instead of simple opacity */
	animated?: boolean;
	/** Use a named group for nested cards */
	groupName?: string;
	/** Additional classes */
	class?: string;
	/** Action buttons */
	children: JSX.Element;
}

// Named group animation classes - must be written out fully for Tailwind JIT
const animatedGroupClasses = {
	default: "max-w-0 group-hover:max-w-[160px] opacity-0 group-hover:opacity-100 group-hover:delay-200 overflow-hidden transition-all duration-300 ease-in-out",
	assignee:
		"max-w-0 group-hover/assignee:max-w-[160px] opacity-0 group-hover/assignee:opacity-100 group-hover/assignee:delay-200 overflow-hidden transition-all duration-300 ease-in-out",
} as const;

export function ConfigCardActions(props: ConfigCardActionsProps) {
	const animatedClass = () => {
		if (!props.animated) return "";
		if (props.alwaysVisible) return "max-w-[160px] opacity-100";
		const key = (props.groupName ?? "default") as keyof typeof animatedGroupClasses;
		return animatedGroupClasses[key] ?? animatedGroupClasses.default;
	};

	return <span class={cn("flex items-center gap-1 shrink-0", animatedClass(), props.class)}>{props.children}</span>;
}

// --- ConfigCardDeleteButton ---

interface ConfigCardDeleteButtonProps {
	/** Click handler */
	onDelete: () => void;
	/** Whether the delete is in progress */
	isDeleting?: boolean;
	/** Whether to always show (not just on hover) */
	alwaysVisible?: boolean;
	/** Use a named group for nested cards */
	groupName?: string;
	/** Disable the button with an optional tooltip message */
	disabledReason?: string;
}

export function ConfigCardDeleteButton(props: ConfigCardDeleteButtonProps) {
	// Build hover class based on whether we have a named group
	const hoverClass = () => {
		if (props.alwaysVisible) return "opacity-100";
		if (props.groupName) return `opacity-0 group-hover/${props.groupName}:opacity-100`;
		return "opacity-0 group-hover:opacity-100";
	};

	const isDisabled = () => props.isDeleting || !!props.disabledReason;

	const button = (
		<Button
			variant="ghost"
			size="icon"
			class={cn(
				"transition-opacity h-8 w-8",
				isDisabled() ? "text-muted-foreground/50 cursor-not-allowed" : "text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer",
				hoverClass(),
			)}
			onClick={(e) => {
				e.stopPropagation();
				if (!isDisabled()) {
					props.onDelete();
				}
			}}
			disabled={isDisabled()}
		>
			<Show when={props.isDeleting} fallback={<Trash2 class="w-4 h-4" />}>
				<LoaderCircle class="w-4 h-4 animate-spin" />
			</Show>
		</Button>
	);

	return (
		<Show when={props.disabledReason} fallback={button}>
			<Tooltip>
				<TooltipTrigger as="span" class="inline-flex">
					{button}
				</TooltipTrigger>
				<TooltipContent>{props.disabledReason}</TooltipContent>
			</Tooltip>
		</Show>
	);
}

// --- ConfigCardExpandedContent ---

interface ConfigCardExpandedContentProps {
	/** Additional classes */
	class?: string;
	/** Expanded content */
	children: JSX.Element;
}

export function ConfigCardExpandedContent(props: ConfigCardExpandedContentProps) {
	return <div class={cn("border-t border-border p-4 space-y-4", props.class)}>{props.children}</div>;
}
