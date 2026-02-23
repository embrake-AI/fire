import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { useServerFn } from "@tanstack/solid-start";
import type { Accessor } from "solid-js";
import { runDemoAware } from "../demo/runtime";
import { addSlackUserAsTeamMemberDemo, addTeamMemberDemo, createTeamDemo, deleteTeamDemo, getTeamsDemo, removeTeamMemberDemo, updateTeamDemo } from "../demo/store";
import type { getUsers } from "../users/users";
import { addSlackUserAsTeamMember, addTeamMember, createTeam, deleteTeam, getTeams, removeTeamMember, updateTeam } from "./teams";

type GetTeamsResponse = Awaited<ReturnType<typeof getTeams>>;
type GetUsersResponse = Awaited<ReturnType<typeof getUsers>>;

export function useTeams(options?: { enabled?: Accessor<boolean> }) {
	const getTeamsFn = useServerFn(getTeams);
	return useQuery(() => ({
		queryKey: ["teams"],
		queryFn: () =>
			runDemoAware({
				demo: () => getTeamsDemo(),
				remote: () => getTeamsFn(),
			}),
		staleTime: 60_000,
		enabled: options?.enabled?.() ?? true,
	}));
}

export function useUpdateTeam(options?: { onMutate?: () => void; onSuccess?: () => void; onError?: () => void }) {
	const queryClient = useQueryClient();
	const updateTeamFn = useServerFn(updateTeam);

	return useMutation(() => ({
		mutationFn: (data: { id: string; name?: string; imageUrl?: string | null }) =>
			runDemoAware({
				demo: () => updateTeamDemo(data),
				remote: () => updateTeamFn({ data }),
			}),

		onMutate: async (newData) => {
			await queryClient.cancelQueries({ queryKey: ["teams"] });

			const previousTeams = queryClient.getQueryData<GetTeamsResponse>(["teams"]);

			queryClient.setQueryData<GetTeamsResponse>(["teams"], (old) => old?.map((t) => (t.id === newData.id ? { ...t, ...newData } : t)));

			options?.onMutate?.();

			return { previousTeams };
		},

		onSuccess: () => {
			options?.onSuccess?.();
			queryClient.invalidateQueries({ queryKey: ["teams"] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previousTeams) {
				queryClient.setQueryData(["teams"], context.previousTeams);
			}
			options?.onError?.();
		},
	}));
}

export function useCreateTeam(options?: { onMutate?: (tempId: string) => void; onSuccess?: (realId: string) => void; onError?: () => void }) {
	const queryClient = useQueryClient();
	const createTeamFn = useServerFn(createTeam);

	return useMutation(() => ({
		mutationFn: (data: { name: string }) =>
			runDemoAware({
				demo: () => createTeamDemo(data),
				remote: () => createTeamFn({ data }),
			}),

		onMutate: async (newData) => {
			await queryClient.cancelQueries({ queryKey: ["teams"] });

			const previousTeams = queryClient.getQueryData<GetTeamsResponse>(["teams"]);

			const tempId = `temp-${Date.now()}`;

			const optimisticTeam = {
				id: tempId,
				name: newData.name,
				imageUrl: null,
				createdAt: new Date(),
				memberCount: 0,
			};

			queryClient.setQueryData<GetTeamsResponse>(["teams"], (old) => [optimisticTeam, ...(old ?? [])]);

			options?.onMutate?.(tempId);

			return { previousTeams, tempId };
		},

		onSuccess: (newTeam, _variables, context) => {
			if (newTeam?.id && context?.tempId) {
				queryClient.setQueryData<GetTeamsResponse>(["teams"], (old) => old?.map((t) => (t.id === context.tempId ? { ...t, id: newTeam.id } : t)));
				options?.onSuccess?.(newTeam.id);
			}
			queryClient.invalidateQueries({ queryKey: ["teams"] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previousTeams) {
				queryClient.setQueryData(["teams"], context.previousTeams);
			}
			options?.onError?.();
		},
	}));
}

export function useDeleteTeam(options?: { onSuccess?: () => void; onError?: () => void }) {
	const queryClient = useQueryClient();
	const deleteTeamFn = useServerFn(deleteTeam);

	return useMutation(() => ({
		mutationFn: (id: string) =>
			runDemoAware({
				demo: () => deleteTeamDemo({ id }),
				remote: () => deleteTeamFn({ data: { id } }),
			}),

		onMutate: async (id) => {
			await queryClient.cancelQueries({ queryKey: ["teams"] });

			const previousTeams = queryClient.getQueryData<GetTeamsResponse>(["teams"]);

			queryClient.setQueryData<GetTeamsResponse>(["teams"], (old) => old?.filter((t) => t.id !== id));

			return { previousTeams };
		},

		onSuccess: () => {
			options?.onSuccess?.();
			queryClient.invalidateQueries({ queryKey: ["teams"] });
			queryClient.invalidateQueries({ queryKey: ["rotations"] });
			queryClient.invalidateQueries({ queryKey: ["entry-points"] });
			queryClient.invalidateQueries({ queryKey: ["services"] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previousTeams) {
				queryClient.setQueryData(["teams"], context.previousTeams);
			}
			options?.onError?.();
		},
	}));
}

type AddTeamMemberMutationInput = {
	teamId: string;
	userId: string;
};

export function useAddTeamMember(options?: { onSuccess?: () => void; onError?: () => void }) {
	const queryClient = useQueryClient();
	const addTeamMemberFn = useServerFn(addTeamMember);

	return useMutation(() => ({
		mutationFn: (data: AddTeamMemberMutationInput) =>
			runDemoAware({
				demo: () => addTeamMemberDemo({ teamId: data.teamId, userId: data.userId }),
				remote: () => addTeamMemberFn({ data: { teamId: data.teamId, userId: data.userId } }),
			}),

		onMutate: async ({ teamId, userId }) => {
			await queryClient.cancelQueries({ queryKey: ["users"] });
			await queryClient.cancelQueries({ queryKey: ["teams"] });

			const previousUsers = queryClient.getQueryData<GetUsersResponse>(["users"]);
			const previousTeams = queryClient.getQueryData<GetTeamsResponse>(["teams"]);

			queryClient.setQueryData<GetUsersResponse>(["users"], (previousUsers) =>
				previousUsers?.map((u) =>
					u.id === userId
						? {
								...u,
								teams: u.teams.some((membership) => membership.id === teamId) ? u.teams : [...u.teams, { id: teamId, role: "ADMIN" }],
							}
						: u,
				),
			);
			queryClient.setQueryData<GetTeamsResponse>(["teams"], (previousTeams) => previousTeams?.map((t) => (t.id === teamId ? { ...t, memberCount: t.memberCount + 1 } : t)));

			return { previousUsers, previousTeams };
		},
		onSuccess: async () => {
			options?.onSuccess?.();
			await queryClient.invalidateQueries({ queryKey: ["users"] });
			await queryClient.invalidateQueries({ queryKey: ["teams"] });
		},
		onError: (_err, _variables, context) => {
			if (context?.previousUsers) {
				queryClient.setQueryData(["users"], context.previousUsers);
			}
			if (context?.previousTeams) {
				queryClient.setQueryData(["teams"], context.previousTeams);
			}
			options?.onError?.();
		},
	}));
}

export function useRemoveTeamMember(options?: { onSuccess?: () => void; onError?: () => void }) {
	const queryClient = useQueryClient();
	const removeTeamMemberFn = useServerFn(removeTeamMember);

	return useMutation(() => ({
		mutationFn: (data: { teamId: string; userId: string }) =>
			runDemoAware({
				demo: () => removeTeamMemberDemo(data),
				remote: () => removeTeamMemberFn({ data }),
			}),

		onMutate: async ({ teamId, userId }) => {
			await queryClient.cancelQueries({ queryKey: ["users"] });
			await queryClient.cancelQueries({ queryKey: ["teams"] });

			const previousUsers = queryClient.getQueryData<GetUsersResponse>(["users"]);
			const previousTeams = queryClient.getQueryData<GetTeamsResponse>(["teams"]);

			queryClient.setQueryData<GetUsersResponse>(["users"], (previousUsers) =>
				previousUsers?.map((u) => (u.id === userId ? { ...u, teams: u.teams.filter((membership) => membership.id !== teamId) } : u)),
			);
			queryClient.setQueryData<GetTeamsResponse>(["teams"], (previousTeams) =>
				previousTeams?.map((t) => (t.id === teamId ? { ...t, memberCount: Math.max(0, t.memberCount - 1) } : t)),
			);

			return { previousUsers, previousTeams };
		},

		onSuccess: () => {
			options?.onSuccess?.();
			queryClient.invalidateQueries({ queryKey: ["users"] });
			queryClient.invalidateQueries({ queryKey: ["teams"] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previousUsers) {
				queryClient.setQueryData(["users"], context.previousUsers);
			}
			if (context?.previousTeams) {
				queryClient.setQueryData(["teams"], context.previousTeams);
			}
			options?.onError?.();
		},
	}));
}

export function useAddSlackUserAsTeamMember(options?: { onSuccess?: () => void; onError?: () => void }) {
	const queryClient = useQueryClient();
	const addSlackUserAsTeamMemberFn = useServerFn(addSlackUserAsTeamMember);

	return useMutation(() => ({
		mutationFn: (data: { teamId: string; slackUserId: string; name: string; avatar?: string | null }) =>
			runDemoAware({
				demo: () => addSlackUserAsTeamMemberDemo({ teamId: data.teamId, slackUserId: data.slackUserId }),
				remote: () => addSlackUserAsTeamMemberFn({ data: { teamId: data.teamId, slackUserId: data.slackUserId } }),
			}),

		onMutate: async ({ teamId, slackUserId, name, avatar }) => {
			await queryClient.cancelQueries({ queryKey: ["users"] });
			await queryClient.cancelQueries({ queryKey: ["teams"] });

			const previousUsers = queryClient.getQueryData<GetUsersResponse>(["users"]);
			const previousTeams = queryClient.getQueryData<GetTeamsResponse>(["teams"]);

			const tempUserId = `temp-slack-${slackUserId}`;
			queryClient.setQueryData<GetUsersResponse>(["users"], (prev) => [
				...(prev ?? []),
				{
					id: tempUserId,
					name,
					email: "",
					image: avatar ?? null,
					teams: [{ id: teamId, role: "ADMIN" as const }],
					connectedIntegrations: [],
					disabled: false,
					slackId: slackUserId,
				},
			]);

			queryClient.setQueryData<GetTeamsResponse>(["teams"], (prev) => prev?.map((t) => (t.id === teamId ? { ...t, memberCount: t.memberCount + 1 } : t)));

			return { previousUsers, previousTeams };
		},

		onSuccess: async (newUser, variables) => {
			const tempUserId = `temp-slack-${variables.slackUserId}`;
			queryClient.setQueryData<GetUsersResponse>(["users"], (prev) => prev?.map((u) => (u.id === tempUserId ? { ...u, id: newUser.userId } : u)));
			options?.onSuccess?.();
			await queryClient.invalidateQueries({ queryKey: ["users"] });
			await queryClient.invalidateQueries({ queryKey: ["teams"] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previousUsers) {
				queryClient.setQueryData(["users"], context.previousUsers);
			}
			if (context?.previousTeams) {
				queryClient.setQueryData(["teams"], context.previousTeams);
			}
			options?.onError?.();
		},
	}));
}
