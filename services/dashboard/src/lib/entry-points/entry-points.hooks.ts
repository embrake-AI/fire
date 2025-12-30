import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { useServerFn } from "@tanstack/solid-start";
import type { Accessor } from "solid-js";
import { type CreateEntryPointInput, createEntryPoint, deleteEntryPoint, getEntryPoints, setFallbackEntryPoint, updateEntryPointPrompt } from "./entry-points";

type GetEntryPointsResponse = Awaited<ReturnType<typeof getEntryPoints>>;

export function useEntryPoints(options?: { enabled?: Accessor<boolean> }) {
	const getEntryPointsFn = useServerFn(getEntryPoints);
	return useQuery(() => ({
		queryKey: ["entry-points"],
		queryFn: () => getEntryPointsFn(),
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

	return useMutation(() => ({
		mutationFn: (data: CreateEntryPointInput) => {
			if (data.type === "user") {
				return createEntryPointFn({ data: { type: "user", userId: data.userId, prompt: data.prompt } });
			} else {
				return createEntryPointFn({ data: { type: "rotation", rotationId: data.rotationId, prompt: data.prompt } });
			}
		},

		onMutate: async (newData) => {
			await queryClient.cancelQueries({ queryKey: ["entry-points"] });

			const previousEntryPoints = queryClient.getQueryData<GetEntryPointsResponse>(["entry-points"]);

			const tempId = `temp-${Date.now()}`;
			const isFirst = (previousEntryPoints?.length ?? 0) === 0;

			const baseOptimistic = {
				id: tempId,
				prompt: "",
				isFallback: isFirst,
			};

			const optimisticEntryPoint: GetEntryPointsResponse[number] =
				newData.type === "user"
					? {
							...baseOptimistic,
							type: "user" as const,
							assigneeId: newData.userId,
							teamId: undefined,
						}
					: {
							...baseOptimistic,
							type: "rotation" as const,
							rotationId: newData.rotationId,
							teamId: newData.teamId ?? null,
						};

			queryClient.setQueryData<GetEntryPointsResponse>(["entry-points"], (old) => [optimisticEntryPoint, ...(old ?? [])]);

			options?.onMutate?.(tempId);

			return { previousEntryPoints, tempId };
		},

		onSuccess: (newEntryPoint, _, context) => {
			if (newEntryPoint?.id && context?.tempId) {
				queryClient.setQueryData<GetEntryPointsResponse>(["entry-points"], (old) => {
					return old?.map((ep) => (ep.id === context.tempId ? { ...ep, id: newEntryPoint.id } : ep));
				});
				options?.onSuccess?.({ id: newEntryPoint.id, tempId: context.tempId });
			}
			queryClient.invalidateQueries({ queryKey: ["entry-points"] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previousEntryPoints) {
				queryClient.setQueryData(["entry-points"], context.previousEntryPoints);
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
		mutationFn: (id: string) => deleteEntryPointFn({ data: { id } }),

		onMutate: async (id) => {
			await queryClient.cancelQueries({ queryKey: ["entry-points"] });

			const previousEntryPoints = queryClient.getQueryData<GetEntryPointsResponse>(["entry-points"]);

			queryClient.setQueryData<GetEntryPointsResponse>(["entry-points"], (old) => old?.filter((ep) => ep.id !== id));

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

export function useUpdateEntryPointPrompt(options?: { onSuccess?: () => void; onError?: () => void }) {
	const queryClient = useQueryClient();

	const updateEntryPointPromptFn = useServerFn(updateEntryPointPrompt);

	return useMutation(() => ({
		mutationFn: (data: { id: string; prompt: string }) => updateEntryPointPromptFn({ data }),

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
		mutationFn: (id: string) => setFallbackEntryPointFn({ data: { id } }),

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
