import { emailInDomains } from "@fire/common";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { useServerFn } from "@tanstack/solid-start";
import { type Accessor, createMemo } from "solid-js";
import { useClient } from "../client/client.hooks";
import { useSlackUsers } from "../useSlackUsers";
import { getCurrentUser, getUsers, updateUser } from "./users";

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
type CurrentUserResponse = Awaited<ReturnType<typeof getCurrentUser>>;

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

export function useCurrentUser() {
	const getCurrentUserFn = useServerFn(getCurrentUser);
	return useQuery(() => ({
		queryKey: ["current-user"],
		queryFn: getCurrentUserFn,
		staleTime: 60_000,
	}));
}

export function useUpdateUser() {
	const queryClient = useQueryClient();
	const updateUserFn = useServerFn(updateUser);
	return useMutation(() => ({
		mutationFn: (data: { name?: string; image?: string | null }) => updateUserFn({ data }),
		onMutate: async (newData) => {
			await queryClient.cancelQueries({ queryKey: ["current-user"] });

			const previousCurrentUser = queryClient.getQueryData<CurrentUserResponse>(["current-user"]);
			const patch = {
				...(newData.name !== undefined && { name: newData.name }),
				...(newData.image !== undefined && { image: newData.image }),
			};

			if (previousCurrentUser) {
				queryClient.setQueryData<CurrentUserResponse>(["current-user"], { ...previousCurrentUser, ...patch });
			}

			return { previousCurrentUser };
		},
		onError: (_err, _variables, context) => {
			if (context?.previousCurrentUser) {
				queryClient.setQueryData(["current-user"], context.previousCurrentUser);
			}
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["current-user"] });
			queryClient.invalidateQueries({ queryKey: ["users"] });
		},
	}));
}
