import { emailInDomains } from "@fire/common";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { useServerFn } from "@tanstack/solid-start";
import { type Accessor, createMemo } from "solid-js";
import { useClient } from "../client/client.hooks";
import { runDemoAware } from "../demo/runtime";
import {
	addWorkspaceUserFromSlackDemo,
	getCurrentUserDemo,
	getUsersDemo,
	getWorkspaceUserProvisioningSettingsDemo,
	getWorkspaceUsersForManagementDemo,
	removeWorkspaceUserDemo,
	updateUserDemo,
	updateWorkspaceUserProvisioningSettingsDemo,
	updateWorkspaceUserRoleDemo,
} from "../demo/store";
import { useSlackUsers } from "../useSlackUsers";
import {
	addWorkspaceUserFromSlack,
	getCurrentUser,
	getUsers,
	getWorkspaceUserProvisioningSettings,
	getWorkspaceUsersForManagement,
	removeWorkspaceUser,
	updateUser,
	updateWorkspaceUserProvisioningSettings,
	updateWorkspaceUserRole,
} from "./users";

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
		queryFn: () =>
			runDemoAware({
				demo: () => getUsersDemo(),
				remote: () => getUsersFn(),
			}),
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
			...users.map((u) => ({ id: u.id, name: u.name, avatar: u.image, type: "user" as const, teams: u.teams, slackId: u.slackId })),
			...slackUsers.map((u) => ({ id: u.id, name: u.name, avatar: u.avatar, type: "slack" as const })),
		].sort((a, b) => a.name.localeCompare(b.name));
	});
	return possibleSlackUsers;
}

export function useCurrentUser() {
	const getCurrentUserFn = useServerFn(getCurrentUser);
	return useQuery(() => ({
		queryKey: ["current-user"],
		queryFn: () =>
			runDemoAware({
				demo: () => getCurrentUserDemo(),
				remote: () => getCurrentUserFn(),
			}),
		staleTime: 60_000,
	}));
}

export function useUpdateUser() {
	const queryClient = useQueryClient();
	const updateUserFn = useServerFn(updateUser);
	return useMutation(() => ({
		mutationFn: (data: { name?: string; image?: string | null }) =>
			runDemoAware({
				demo: () => updateUserDemo(data),
				remote: () => updateUserFn({ data }),
			}),
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

export type ManageableUserRole = "VIEWER" | "MEMBER" | "ADMIN";

type WorkspaceUsersManagementResponse = Awaited<ReturnType<typeof getWorkspaceUsersForManagement>>;
type WorkspaceUserProvisioningSettingsResponse = Awaited<ReturnType<typeof getWorkspaceUserProvisioningSettings>>;

export function useWorkspaceUsersForManagement() {
	const getWorkspaceUsersForManagementFn = useServerFn(getWorkspaceUsersForManagement);
	return useQuery(() => ({
		queryKey: ["workspace-users-management"],
		queryFn: () =>
			runDemoAware({
				demo: () => getWorkspaceUsersForManagementDemo(),
				remote: () => getWorkspaceUsersForManagementFn(),
			}),
		staleTime: 60_000,
	}));
}

export function useUpdateWorkspaceUserRole() {
	const queryClient = useQueryClient();
	const updateWorkspaceUserRoleFn = useServerFn(updateWorkspaceUserRole);
	return useMutation(() => ({
		mutationFn: (data: { userId: string; role: ManageableUserRole }) =>
			runDemoAware({
				demo: () => updateWorkspaceUserRoleDemo(data),
				remote: () => updateWorkspaceUserRoleFn({ data }),
			}),
		onMutate: async (newData) => {
			await queryClient.cancelQueries({ queryKey: ["workspace-users-management"] });
			const previousUsers = queryClient.getQueryData<WorkspaceUsersManagementResponse>(["workspace-users-management"]);
			queryClient.setQueryData<WorkspaceUsersManagementResponse>(["workspace-users-management"], (previous) =>
				previous?.map((workspaceUser) =>
					workspaceUser.id === newData.userId ? { ...workspaceUser, role: newData.role, isRoleEditable: newData.role !== "ADMIN" } : workspaceUser,
				),
			);
			return { previousUsers };
		},
		onError: (_err, _variables, context) => {
			if (context?.previousUsers) {
				queryClient.setQueryData(["workspace-users-management"], context.previousUsers);
			}
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["workspace-users-management"] });
			queryClient.invalidateQueries({ queryKey: ["users"] });
		},
	}));
}

export function useWorkspaceUserProvisioningSettings() {
	const getWorkspaceUserProvisioningSettingsFn = useServerFn(getWorkspaceUserProvisioningSettings);
	return useQuery(() => ({
		queryKey: ["workspace-user-provisioning-settings"],
		queryFn: () =>
			runDemoAware({
				demo: () => getWorkspaceUserProvisioningSettingsDemo(),
				remote: () => getWorkspaceUserProvisioningSettingsFn(),
			}),
		staleTime: 60_000,
	}));
}

export function useUpdateWorkspaceUserProvisioningSettings() {
	const queryClient = useQueryClient();
	const updateWorkspaceUserProvisioningSettingsFn = useServerFn(updateWorkspaceUserProvisioningSettings);
	return useMutation(() => ({
		mutationFn: (data: { defaultUserRole?: ManageableUserRole; autoCreateUsersWithSso?: boolean }) =>
			runDemoAware({
				demo: () => updateWorkspaceUserProvisioningSettingsDemo(data),
				remote: () => updateWorkspaceUserProvisioningSettingsFn({ data }),
			}),
		onMutate: async (newData) => {
			await queryClient.cancelQueries({ queryKey: ["workspace-user-provisioning-settings"] });
			const previousSettings = queryClient.getQueryData<WorkspaceUserProvisioningSettingsResponse>(["workspace-user-provisioning-settings"]);
			if (previousSettings) {
				queryClient.setQueryData<WorkspaceUserProvisioningSettingsResponse>(["workspace-user-provisioning-settings"], {
					...previousSettings,
					...(newData.defaultUserRole !== undefined && { defaultUserRole: newData.defaultUserRole }),
					...(newData.autoCreateUsersWithSso !== undefined && { autoCreateUsersWithSso: newData.autoCreateUsersWithSso }),
				});
			}
			return { previousSettings };
		},
		onError: (_err, _variables, context) => {
			if (context?.previousSettings) {
				queryClient.setQueryData(["workspace-user-provisioning-settings"], context.previousSettings);
			}
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["workspace-user-provisioning-settings"] });
		},
	}));
}

export function useAddWorkspaceUserFromSlack() {
	const queryClient = useQueryClient();
	const addWorkspaceUserFromSlackFn = useServerFn(addWorkspaceUserFromSlack);
	return useMutation(() => ({
		mutationFn: (data: { slackUserId: string; name: string; avatar?: string }) =>
			runDemoAware({
				demo: () => addWorkspaceUserFromSlackDemo({ slackUserId: data.slackUserId }),
				remote: () => addWorkspaceUserFromSlackFn({ data: { slackUserId: data.slackUserId } }),
			}),
		onMutate: async (newData) => {
			await queryClient.cancelQueries({ queryKey: ["workspace-users-management"] });
			const previousUsers = queryClient.getQueryData<WorkspaceUsersManagementResponse>(["workspace-users-management"]);
			const optimisticUser = {
				id: `optimistic-${newData.slackUserId}`,
				name: newData.name,
				email: "",
				image: newData.avatar ?? null,
				slackId: newData.slackUserId,
				role: "MEMBER" as const,
				isRoleEditable: true,
			};
			queryClient.setQueryData<WorkspaceUsersManagementResponse>(["workspace-users-management"], (previous) =>
				[...(previous ?? []), optimisticUser].sort((a, b) => a.name.localeCompare(b.name)),
			);
			return { previousUsers };
		},
		onError: (_err, _variables, context) => {
			if (context?.previousUsers) {
				queryClient.setQueryData(["workspace-users-management"], context.previousUsers);
			}
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["workspace-users-management"] });
			queryClient.invalidateQueries({ queryKey: ["users"] });
		},
	}));
}

export function useRemoveWorkspaceUser() {
	const queryClient = useQueryClient();
	const removeWorkspaceUserFn = useServerFn(removeWorkspaceUser);
	return useMutation(() => ({
		mutationFn: (data: { userId: string }) =>
			runDemoAware({
				demo: () => removeWorkspaceUserDemo(data),
				remote: () => removeWorkspaceUserFn({ data }),
			}),
		onMutate: async ({ userId }) => {
			await queryClient.cancelQueries({ queryKey: ["workspace-users-management"] });
			const previousUsers = queryClient.getQueryData<WorkspaceUsersManagementResponse>(["workspace-users-management"]);
			queryClient.setQueryData<WorkspaceUsersManagementResponse>(["workspace-users-management"], (previous) => previous?.filter((workspaceUser) => workspaceUser.id !== userId));
			return { previousUsers };
		},
		onError: (_err, _variables, context) => {
			if (context?.previousUsers) {
				queryClient.setQueryData(["workspace-users-management"], context.previousUsers);
			}
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["workspace-users-management"] });
			queryClient.invalidateQueries({ queryKey: ["users"] });
		},
	}));
}
