import type { Accessor } from "solid-js";
import { Show } from "solid-js";

export function UserAvatar(props: { name: Accessor<string>; withName?: boolean; avatar?: Accessor<string | undefined> }) {
	const initials = () =>
		props
			.name()
			.split(" ")
			.map((n) => n[0])
			.join("")
			.slice(0, 2);

	return (
		<Show when={props.avatar?.()} fallback={<div class="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-600 font-medium text-sm">{initials()}</div>}>
			{(avatar) => (
				<>
					<img src={avatar()} alt={props.name()} class="w-8 h-8 rounded-full object-cover shrink-0" />
					<Show when={props.withName && props.name()}>
						<div class="flex flex-col">
							<span class="truncate">{props.name()}</span>
						</div>
					</Show>
				</>
			)}
		</Show>
	);
}
