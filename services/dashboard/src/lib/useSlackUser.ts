import { type Accessor, createMemo } from "solid-js";
import { useSlackUsers } from "./useSlackUsers";

export function useSlackUser(id: Accessor<string | null>) {
	const slackUsersQuery = useSlackUsers();

	const user = createMemo(() => {
		const currentId = id();
		if (currentId) {
			return slackUsersQuery.data?.find((u) => u.id === currentId);
		}
		return undefined;
	});

	return user;
}
