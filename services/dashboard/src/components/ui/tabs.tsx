import type { PolymorphicProps } from "@kobalte/core/polymorphic";
import * as TabsPrimitive from "@kobalte/core/tabs";
import type { ValidComponent } from "solid-js";
import { splitProps } from "solid-js";

import { cn } from "~/lib/utils/client";

const Tabs = TabsPrimitive.Root;

type TabsVariant = "default" | "underline";

type TabsListProps<T extends ValidComponent = "div"> = TabsPrimitive.TabsListProps<T> & {
	class?: string | undefined;
	variant?: TabsVariant;
};

const TabsList = <T extends ValidComponent = "div">(props: PolymorphicProps<T, TabsListProps<T>>) => {
	const [local, others] = splitProps(props as TabsListProps, ["class", "variant"]);
	return (
		<TabsPrimitive.List
			class={cn(
				"inline-flex items-center text-muted-foreground",
				local.variant === "underline" ? "h-auto gap-4 justify-start bg-transparent p-0" : "h-10 justify-center rounded-md bg-muted p-1",
				local.class,
			)}
			{...others}
		/>
	);
};

type TabsTriggerProps<T extends ValidComponent = "button"> = TabsPrimitive.TabsTriggerProps<T> & {
	class?: string | undefined;
	variant?: TabsVariant;
};

const TabsTrigger = <T extends ValidComponent = "button">(props: PolymorphicProps<T, TabsTriggerProps<T>>) => {
	const [local, others] = splitProps(props as TabsTriggerProps, ["class", "variant"]);
	return (
		<TabsPrimitive.Trigger
			class={cn(
				"cursor-pointer inline-flex items-center justify-center whitespace-nowrap text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
				local.variant === "underline"
					? "px-0 py-2 bg-transparent hover:bg-transparent rounded-none border-b-2 border-transparent hover:border-muted-foreground/50 hover:text-foreground data-[selected]:border-foreground data-[selected]:text-foreground"
					: "rounded-sm px-3 py-1.5 hover:bg-muted/50 hover:text-foreground data-[selected]:bg-background data-[selected]:text-foreground data-[selected]:shadow-sm",
				local.class,
			)}
			{...others}
		/>
	);
};

type TabsContentProps<T extends ValidComponent = "div"> = TabsPrimitive.TabsContentProps<T> & {
	class?: string | undefined;
};

const TabsContent = <T extends ValidComponent = "div">(props: PolymorphicProps<T, TabsContentProps<T>>) => {
	const [local, others] = splitProps(props as TabsContentProps, ["class"]);
	return (
		<TabsPrimitive.Content
			class={cn("mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2", local.class)}
			{...others}
		/>
	);
};

type TabsIndicatorProps<T extends ValidComponent = "div"> = TabsPrimitive.TabsIndicatorProps<T> & {
	class?: string | undefined;
};

const TabsIndicator = <T extends ValidComponent = "div">(props: PolymorphicProps<T, TabsIndicatorProps<T>>) => {
	const [local, others] = splitProps(props as TabsIndicatorProps, ["class"]);
	return (
		<TabsPrimitive.Indicator
			class={cn(
				"duration-250ms absolute transition-all data-[orientation=horizontal]:-bottom-px data-[orientation=vertical]:-right-px data-[orientation=horizontal]:h-[2px] data-[orientation=vertical]:w-[2px]",
				local.class,
			)}
			{...others}
		/>
	);
};

export { Tabs, TabsList, TabsTrigger, TabsContent, TabsIndicator };
