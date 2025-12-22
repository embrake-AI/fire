import type { PolymorphicProps } from "@kobalte/core/polymorphic";
import * as ToastPrimitive from "@kobalte/core/toast";
import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";
import type { JSX, ValidComponent } from "solid-js";
import { Match, Switch, splitProps } from "solid-js";
import { Portal } from "solid-js/web";

import { cn } from "~/lib/utils/client";

const toastVariants = cva(
	"group pointer-events-auto relative flex w-full items-center justify-between gap-3 overflow-hidden rounded-lg border bg-card p-4 pr-10 shadow-lg transition-all data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--kb-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--kb-toast-swipe-move-x)] data-[swipe=move]:transition-none data-[opened]:animate-in data-[closed]:animate-out data-[swipe=end]:animate-out data-[closed]:fade-out-80 data-[closed]:slide-out-to-right-full data-[opened]:slide-in-from-top-full data-[opened]:sm:slide-in-from-bottom-full",
	{
		variants: {
			variant: {
				default: "border-border text-card-foreground",
				destructive: "destructive border-destructive/50 text-card-foreground",
				success: "success border-emerald-500/50 text-card-foreground",
				warning: "warning border-amber-500/50 text-card-foreground",
				error: "error border-red-500/50 text-card-foreground",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);
type ToastVariant = NonNullable<VariantProps<typeof toastVariants>["variant"]>;

type ToastListProps<T extends ValidComponent = "ol"> = ToastPrimitive.ToastListProps<T> & {
	class?: string | undefined;
};

const Toaster = <T extends ValidComponent = "ol">(props: PolymorphicProps<T, ToastListProps<T>>) => {
	const [local, others] = splitProps(props as ToastListProps, ["class"]);
	return (
		<Portal>
			<ToastPrimitive.Region>
				<ToastPrimitive.List
					class={cn("fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse gap-2 p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px]", local.class)}
					{...others}
				/>
			</ToastPrimitive.Region>
		</Portal>
	);
};

type ToastRootProps<T extends ValidComponent = "li"> = ToastPrimitive.ToastRootProps<T> & VariantProps<typeof toastVariants> & { class?: string | undefined };

const Toast = <T extends ValidComponent = "li">(props: PolymorphicProps<T, ToastRootProps<T>>) => {
	const [local, others] = splitProps(props as ToastRootProps, ["class", "variant"]);
	return <ToastPrimitive.Root class={cn(toastVariants({ variant: local.variant }), local.class)} {...others} />;
};

type ToastCloseButtonProps<T extends ValidComponent = "button"> = ToastPrimitive.ToastCloseButtonProps<T> & { class?: string | undefined };

const ToastClose = <T extends ValidComponent = "button">(props: PolymorphicProps<T, ToastCloseButtonProps<T>>) => {
	const [local, others] = splitProps(props as ToastCloseButtonProps, ["class"]);
	return (
		<ToastPrimitive.CloseButton
			class={cn(
				"absolute right-3 top-3 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 cursor-pointer text-muted-foreground hover:text-foreground",
				local.class,
			)}
			{...others}
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				class="size-4"
				aria-label="Close"
				role="img"
			>
				<title>Close</title>
				<path d="M18 6l-12 12" />
				<path d="M6 6l12 12" />
			</svg>
		</ToastPrimitive.CloseButton>
	);
};

type ToastTitleProps<T extends ValidComponent = "div"> = ToastPrimitive.ToastTitleProps<T> & {
	class?: string | undefined;
};

const ToastTitle = <T extends ValidComponent = "div">(props: PolymorphicProps<T, ToastTitleProps<T>>) => {
	const [local, others] = splitProps(props as ToastTitleProps, ["class"]);
	return <ToastPrimitive.Title class={cn("text-sm font-semibold leading-none tracking-tight", local.class)} {...others} />;
};

type ToastDescriptionProps<T extends ValidComponent = "div"> = ToastPrimitive.ToastDescriptionProps<T> & { class?: string | undefined };

const ToastDescription = <T extends ValidComponent = "div">(props: PolymorphicProps<T, ToastDescriptionProps<T>>) => {
	const [local, others] = splitProps(props as ToastDescriptionProps, ["class"]);
	return <ToastPrimitive.Description class={cn("text-sm text-muted-foreground", local.class)} {...others} />;
};

const variantIcon: Record<ToastVariant, JSX.Element> = {
	default: (
		<div class="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted" aria-hidden="true">
			<svg
				class="size-4 text-muted-foreground"
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<title>Info</title>
				<circle cx="12" cy="12" r="10" />
				<path d="M12 16v-4" />
				<path d="M12 8h.01" />
			</svg>
		</div>
	),
	destructive: (
		<div class="flex size-8 shrink-0 items-center justify-center rounded-full bg-destructive/10" aria-hidden="true">
			<svg
				class="size-4 text-destructive"
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<title>Destructive</title>
				<circle cx="12" cy="12" r="10" />
				<path d="m15 9-6 6" />
				<path d="m9 9 6 6" />
			</svg>
		</div>
	),
	success: (
		<div class="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/10" aria-hidden="true">
			<svg
				class="size-4 text-emerald-500"
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<title>Success</title>
				<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
				<path d="m9 11 3 3L22 4" />
			</svg>
		</div>
	),
	warning: (
		<div class="flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-500/10" aria-hidden="true">
			<svg
				class="size-4 text-amber-500"
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<title>Warning</title>
				<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
				<path d="M12 9v4" />
				<path d="M12 17h.01" />
			</svg>
		</div>
	),
	error: (
		<div class="flex size-8 shrink-0 items-center justify-center rounded-full bg-red-500/10" aria-hidden="true">
			<svg
				class="size-4 text-red-500"
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<title>Error</title>
				<circle cx="12" cy="12" r="10" />
				<path d="m15 9-6 6" />
				<path d="m9 9 6 6" />
			</svg>
		</div>
	),
};

function showToast(props: { title?: JSX.Element; description?: JSX.Element; variant?: ToastVariant; duration?: number }) {
	const variant = props.variant ?? "default";
	ToastPrimitive.toaster.show((data) => (
		<Toast toastId={data.toastId} variant={variant} duration={props.duration}>
			{variantIcon[variant]}
			<div class="grid gap-1 flex-1">
				{props.title && <ToastTitle>{props.title}</ToastTitle>}
				{props.description && <ToastDescription>{props.description}</ToastDescription>}
			</div>
			<ToastClose />
		</Toast>
	));
}

function showToastPromise<T, U>(
	promise: Promise<T> | (() => Promise<T>),
	options: {
		loading?: JSX.Element;
		success?: (data: T) => JSX.Element;
		error?: (error: U) => JSX.Element;
		duration?: number;
	},
) {
	const variant: { [key in ToastPrimitive.ToastPromiseState]: ToastVariant } = {
		pending: "default",
		fulfilled: "success",
		rejected: "error",
	};
	return ToastPrimitive.toaster.promise<T, U>(promise, (props) => (
		<Toast toastId={props.toastId} variant={variant[props.state]} duration={options.duration}>
			<Switch>
				<Match when={props.state === "pending"}>{options.loading}</Match>
				<Match when={props.state === "fulfilled"}>{options.success?.(props.data!)}</Match>
				<Match when={props.state === "rejected"}>{options.error?.(props.error!)}</Match>
			</Switch>
		</Toast>
	));
}

export { Toaster, Toast, ToastClose, ToastTitle, ToastDescription, showToast, showToastPromise };
