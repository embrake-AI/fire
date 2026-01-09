import type { Accessor } from "solid-js";
import { createMemo, Show } from "solid-js";

export function UserAvatar(props: { name: Accessor<string>; withName?: boolean; avatar?: Accessor<string | null | undefined>; sizeClass?: string }) {
	const initials = () =>
		props
			.name()
			.split(" ")
			.map((n) => n[0])
			.join("")
			.slice(0, 2);

	const avatarUrl = createMemo(() => props.avatar?.());
	const sizeClass = () => props.sizeClass ?? "w-8 h-8";

	return (
		<>
			<Show
				when={avatarUrl()}
				fallback={<div class={`flex items-center justify-center ${sizeClass()} rounded-full bg-blue-100 text-blue-600 font-medium text-sm shrink-0`}>{initials()}</div>}
			>
				{(avatar) => <img src={avatar()} alt={props.name()} loading="lazy" decoding="async" class={`${sizeClass()} rounded-full object-cover shrink-0`} />}
			</Show>
			<Show when={props.withName && props.name()}>
				<span class="truncate">{props.name()}</span>
			</Show>
		</>
	);
}
