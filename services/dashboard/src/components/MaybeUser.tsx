import type { Accessor } from "solid-js";
import { Show } from "solid-js";
import { UserAvatar } from "./UserAvatar";

export function UserDisplay({ user, withName }: { user: Accessor<{ name: string; avatar?: string | undefined } | undefined>; withName?: boolean }) {
	return (
		<Show when={user()} fallback={<span class="text-sm text-muted-foreground">data.assignee</span>}>
			{(existingUser) => {
				return <UserAvatar name={() => existingUser().name} avatar={() => existingUser().avatar} withName={withName} />;
			}}
		</Show>
	);
}
