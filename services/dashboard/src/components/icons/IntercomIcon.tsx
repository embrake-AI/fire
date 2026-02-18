import type { ComponentProps } from "solid-js";
import { splitProps } from "solid-js";
import { cn } from "~/lib/utils/client";

export function IntercomIcon(props: ComponentProps<"svg">) {
	const [local, others] = splitProps(props, ["class"]);
	return (
		<svg role="img" aria-label="Intercom" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" class={cn("shrink-0", local.class)} {...others}>
			<circle cx="16" cy="16" r="16" fill="currentColor" />
			<rect x="9" y="9" width="2.4" height="11" rx="1.2" fill="#fff" />
			<rect x="13" y="7.5" width="2.4" height="13.5" rx="1.2" fill="#fff" />
			<rect x="16.9" y="7.5" width="2.4" height="13.5" rx="1.2" fill="#fff" />
			<rect x="20.8" y="9" width="2.4" height="11" rx="1.2" fill="#fff" />
			<path d="M10 22.5c1.7 1.8 3.8 2.7 6 2.7s4.3-.9 6-2.7" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" />
		</svg>
	);
}
