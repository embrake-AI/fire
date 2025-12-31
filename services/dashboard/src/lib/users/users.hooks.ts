import { emailInDomains } from "@fire/common";
import { useQuery } from "@tanstack/solid-query";
import { useServerFn } from "@tanstack/solid-start";
import { type Accessor, createMemo } from "solid-js";
import { useClient } from "../client/client.hooks";
import { getUsers } from "../teams/teams";
import { useSlackUsers } from "../useSlackUsers";

export function useUserBySlackId(slackId: Accessor<string>, options?: { enabled?: Accessor<boolean> }) {
	const usersQuery = useUsers(options);
	const slackUsersQuery = useSlackUsers();
	const user = createMemo(() => {
		const user = usersQuery.data?.find((u) => u.slackId === slackId());
		if (user) {
			return {
				id: user.id,
				name: user.name,
				avatar: user.image ?? undefined,
				type: "user" as const,
			};
		} else {
			const slackUser = slackUsersQuery.data?.find((u) => u.id === slackId());
			if (slackUser) {
				return {
					id: slackUser.id,
					name: slackUser.name,
					avatar: slackUser.avatar,
					type: "slack" as const,
				};
			}
		}
	});
	return user;
}

export function useUsers(options?: { enabled?: Accessor<boolean> }) {
	const getUsersFn = useServerFn(getUsers);
	return useQuery(() => ({
		queryKey: ["users"],
		queryFn: getUsersFn,
		staleTime: 60_000,
		enabled: options?.enabled?.() ?? true,
	}));
}

type GetUsersResponse = Awaited<ReturnType<typeof getUsers>>;
type UserWithSlackId = GetUsersResponse[number] & { slackId: string };

export function usePossibleSlackUsers(options?: { enabled: Accessor<boolean> }) {
	const usersQuery = useUsers(options);
	const slackUsersQuery = useSlackUsers();
	const clientQuery = useClient();
	const possibleSlackUsers = createMemo(() => {
		const users = usersQuery.data?.filter((u): u is UserWithSlackId => !!u.slackId) ?? [];
		const slackUsers = slackUsersQuery.data?.filter((u) => emailInDomains(u.email, clientQuery.data?.domains ?? []) && !users.some((user) => user.slackId === u.id)) ?? [];

		return [
			...users.map((u) => ({ id: u.id, name: u.name, avatar: u.image, type: "user" as const, teamIds: u.teamIds, slackId: u.slackId })),
			...slackUsers.map((u) => ({ id: u.id, name: u.name, avatar: u.avatar, type: "slack" as const })),
		];
	});
	return possibleSlackUsers;
}
