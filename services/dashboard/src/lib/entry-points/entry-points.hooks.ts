import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { useServerFn } from "@tanstack/solid-start";
import type { Accessor } from "solid-js";
import { runDemoAware } from "../demo/runtime";
import {
	createEntryPointDemo,
	createEntryPointFromSlackUserDemo,
	deleteEntryPointDemo,
	getEntryPointsDemo,
	setFallbackEntryPointDemo,
	updateEntryPointPromptDemo,
} from "../demo/store";
import type { getUsers } from "../users/users";
import {
	type CreateEntryPointInput,
	createEntryPoint,
	createEntryPointFromSlackUser,
	deleteEntryPoint,
	getEntryPoints,
	setFallbackEntryPoint,
	updateEntryPointPrompt,
} from "./entry-points";

type GetEntryPointsResponse = Awaited<ReturnType<typeof getEntryPoints>>;
type GetUsersResponse = Awaited<ReturnType<typeof getUsers>>;

type CreateEntryPointInputWithSlack = CreateEntryPointInput | { type: "slack-user"; slackUserId: string; prompt?: string; name?: string; avatar?: string | null };

export function useEntryPoints(options?: { enabled?: Accessor<boolean> }) {
	const getEntryPointsFn = useServerFn(getEntryPoints);
	return useQuery(() => ({
		queryKey: ["entry-points"],
		queryFn: () =>
			runDemoAware({
				demo: () => getEntryPointsDemo(),
				remote: () => getEntryPointsFn(),
			}),
		staleTime: 60_000,
		enabled: options?.enabled?.() ?? true,
	}));
}

export function useCreateEntryPoint(options?: {
	onMutate?: (tempId: string) => void;
	onSuccess?: (result: { id: string; tempId: string }) => void;
	onError?: () => void;
	onSettled?: () => void;
}) {
	const queryClient = useQueryClient();

	const createEntryPointFn = useServerFn(createEntryPoint);
	const createEntryPointFromSlackUserFn = useServerFn(createEntryPointFromSlackUser);

	return useMutation(() => ({
		mutationFn: (data: CreateEntryPointInputWithSlack) => {
			switch (data.type) {
				case "user":
					return runDemoAware({
						demo: () => createEntryPointDemo({ type: "user", userId: data.userId, prompt: data.prompt }),
						remote: () => createEntryPointFn({ data: { type: "user", userId: data.userId, prompt: data.prompt } }),
					});
				case "rotation":
					return runDemoAware({
						demo: () => createEntryPointDemo({ type: "rotation", rotationId: data.rotationId, prompt: data.prompt }),
						remote: () => createEntryPointFn({ data: { type: "rotation", rotationId: data.rotationId, prompt: data.prompt } }),
					});
				case "slack-user":
					return runDemoAware({
						demo: () => createEntryPointFromSlackUserDemo({ slackUserId: data.slackUserId, prompt: data.prompt }),
						remote: () => createEntryPointFromSlackUserFn({ data: { slackUserId: data.slackUserId, prompt: data.prompt } }),
					});
				default:
					throw new Error("Invalid entry point type");
			}
		},

		onMutate: async (newData) => {
			await queryClient.cancelQueries({ queryKey: ["entry-points"] });

			const previousEntryPoints = queryClient.getQueryData<GetEntryPointsResponse>(["entry-points"]);
			let previousUsers: GetUsersResponse | undefined;
			let tempUserId: string | undefined;

			if (newData.type === "slack-user") {
				await queryClient.cancelQueries({ queryKey: ["users"] });

				previousUsers = queryClient.getQueryData<GetUsersResponse>(["users"]);
				const slackTempUserId = `temp-slack-${newData.slackUserId}`;
				tempUserId = slackTempUserId;

				queryClient.setQueryData<GetUsersResponse>(["users"], (prev) => {
					if (prev?.some((user) => user.id === slackTempUserId)) {
						return prev;
					}
					return [
						...(prev ?? []),
						{
							id: slackTempUserId,
							name: newData.name ?? "Slack user",
							email: "",
							image: newData.avatar ?? null,
							teamIds: [],
							slackId: newData.slackUserId,
						},
					];
				});
			}

			const tempId = `temp-${Date.now()}`;
			const isFirst = (previousEntryPoints?.length ?? 0) === 0;

			const baseOptimistic = {
				id: tempId,
				prompt: "",
				isFallback: isFirst,
			};

			const optimisticEntryPoint: GetEntryPointsResponse[number] =
				newData.type === "rotation"
					? {
							...baseOptimistic,
							type: "rotation" as const,
							rotationId: newData.rotationId,
							teamId: newData.teamId ?? null,
						}
					: {
							...baseOptimistic,
							type: "user" as const,
							assigneeId: newData.type === "user" ? newData.userId : (tempUserId ?? newData.slackUserId),
							teamId: undefined,
						};

			queryClient.setQueryData<GetEntryPointsResponse>(["entry-points"], (old) => [optimisticEntryPoint, ...(old ?? [])]);

			options?.onMutate?.(tempId);

			return { previousEntryPoints, previousUsers, tempId, tempUserId };
		},

		onSuccess: (newEntryPoint, variables, context) => {
			if (newEntryPoint?.id && context?.tempId) {
				queryClient.setQueryData<GetEntryPointsResponse>(["entry-points"], (old) => {
					return old?.map((ep) => {
						if (ep.id !== context.tempId) return ep;
						if (variables.type === "slack-user" && context.tempUserId && newEntryPoint.assigneeId && ep.type === "user") {
							return { ...ep, id: newEntryPoint.id, assigneeId: newEntryPoint.assigneeId };
						}
						return { ...ep, id: newEntryPoint.id };
					});
				});
				options?.onSuccess?.({ id: newEntryPoint.id, tempId: context.tempId });
			}

			if (variables.type === "slack-user" && context?.tempUserId && newEntryPoint?.assigneeId) {
				const nextUserId = newEntryPoint.assigneeId;
				queryClient.setQueryData<GetUsersResponse>(["users"], (prev) => prev?.map((user) => (user.id === context.tempUserId ? { ...user, id: nextUserId } : user)));
				queryClient.invalidateQueries({ queryKey: ["users"] });
			}
			queryClient.invalidateQueries({ queryKey: ["entry-points"] });
			queryClient.invalidateQueries({ queryKey: ["rotations"] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previousEntryPoints) {
				queryClient.setQueryData(["entry-points"], context.previousEntryPoints);
			}
			if (context?.previousUsers) {
				queryClient.setQueryData(["users"], context.previousUsers);
			}
			options?.onError?.();
		},
		onSettled: () => {
			options?.onSettled?.();
		},
	}));
}

export function useDeleteEntryPoint(options?: { onSuccess?: () => void; onError?: () => void }) {
	const queryClient = useQueryClient();

	const deleteEntryPointFn = useServerFn(deleteEntryPoint);

	return useMutation(() => ({
		mutationFn: (id: string) =>
			runDemoAware({
				demo: () => deleteEntryPointDemo({ id }),
				remote: () => deleteEntryPointFn({ data: { id } }),
			}),

		onMutate: async (id) => {
			await queryClient.cancelQueries({ queryKey: ["entry-points"] });

			const previousEntryPoints = queryClient.getQueryData<GetEntryPointsResponse>(["entry-points"]);

			queryClient.setQueryData<GetEntryPointsResponse>(["entry-points"], (old) => old?.filter((ep) => ep.id !== id));

			return { previousEntryPoints };
		},

		onSuccess: () => {
			options?.onSuccess?.();
			queryClient.invalidateQueries({ queryKey: ["entry-points"] });
			queryClient.invalidateQueries({ queryKey: ["rotations"] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previousEntryPoints) {
				queryClient.setQueryData(["entry-points"], context.previousEntryPoints);
			}
			options?.onError?.();
		},
	}));
}

export function useUpdateEntryPointPrompt(options?: { onSuccess?: () => void; onError?: () => void }) {
	const queryClient = useQueryClient();

	const updateEntryPointPromptFn = useServerFn(updateEntryPointPrompt);

	return useMutation(() => ({
		mutationFn: (data: { id: string; prompt: string }) =>
			runDemoAware({
				demo: () => updateEntryPointPromptDemo(data),
				remote: () => updateEntryPointPromptFn({ data }),
			}),

		onMutate: async ({ id, prompt }) => {
			await queryClient.cancelQueries({ queryKey: ["entry-points"] });

			const previousEntryPoints = queryClient.getQueryData<GetEntryPointsResponse>(["entry-points"]);

			queryClient.setQueryData<GetEntryPointsResponse>(["entry-points"], (old) => old?.map((ep) => (ep.id === id ? { ...ep, prompt } : ep)));

			return { previousEntryPoints };
		},

		onSuccess: () => {
			options?.onSuccess?.();
			queryClient.invalidateQueries({ queryKey: ["entry-points"] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previousEntryPoints) {
				queryClient.setQueryData(["entry-points"], context.previousEntryPoints);
			}
			options?.onError?.();
		},
	}));
}

export function useSetFallbackEntryPoint(options?: { onSuccess?: () => void; onError?: () => void }) {
	const queryClient = useQueryClient();

	const setFallbackEntryPointFn = useServerFn(setFallbackEntryPoint);

	return useMutation(() => ({
		mutationFn: (id: string) =>
			runDemoAware({
				demo: () => setFallbackEntryPointDemo({ id }),
				remote: () => setFallbackEntryPointFn({ data: { id } }),
			}),

		onMutate: async (id) => {
			await queryClient.cancelQueries({ queryKey: ["entry-points"] });

			const previousEntryPoints = queryClient.getQueryData<GetEntryPointsResponse>(["entry-points"]);

			queryClient.setQueryData<GetEntryPointsResponse>(["entry-points"], (old) => old?.map((ep) => ({ ...ep, isFallback: ep.id === id })));

			return { previousEntryPoints };
		},

		onSuccess: () => {
			options?.onSuccess?.();
			queryClient.invalidateQueries({ queryKey: ["entry-points"] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previousEntryPoints) {
				queryClient.setQueryData(["entry-points"], context.previousEntryPoints);
			}
			options?.onError?.();
		},
	}));
}
