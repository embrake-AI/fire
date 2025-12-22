import { useMutation, useQueryClient } from "@tanstack/solid-query";
import { useServerFn } from "@tanstack/solid-start";
import type { EntryPoint, SlackUser, SlackUserGroup } from "./entry-points";
import { createEntryPoint, deleteEntryPoint, updateEntryPointPrompt } from "./entry-points";

/**
 * Hook for creating entry points with optimistic updates.
 * Immediately adds the new entry point to the cache, then syncs with server.
 */
export function useCreateEntryPoint(options?: { onMutate?: (tempId: string) => void; onSuccess?: (realId: string) => void; onError?: () => void; onSettled?: () => void }) {
	const queryClient = useQueryClient();

	const createEntryPointFn = useServerFn(createEntryPoint);

	return useMutation(() => ({
		mutationFn: (data: { id: string; type: "slack-user" | "slack-user-group"; optimisticData: { name: string; avatar?: string } }) =>
			createEntryPointFn({ data: { id: data.id, type: data.type } }),

		onMutate: async (newData) => {
			await queryClient.cancelQueries({ queryKey: ["entry-points"] });

			const previousEntryPoints = queryClient.getQueryData<EntryPoint[]>(["entry-points"]);

			const tempId = `temp-${Date.now()}`;
			const optimisticEntryPoint = {
				id: tempId,
				type: newData.type,
				prompt: "",
				assigneeId: newData.id,
				name: newData.optimisticData.name,
				avatar: newData.optimisticData.avatar,
			};

			queryClient.setQueryData<EntryPoint[]>(["entry-points"], (old) => [optimisticEntryPoint, ...(old ?? [])]);

			options?.onMutate?.(tempId);

			return { previousEntryPoints, tempId };
		},

		onSuccess: (newEntryPoint) => {
			if (newEntryPoint?.id) {
				options?.onSuccess?.(newEntryPoint.id);
			}
			queryClient.invalidateQueries({ queryKey: ["entry-points"] });
			queryClient.invalidateQueries({ queryKey: ["slack-users"] });
			queryClient.invalidateQueries({ queryKey: ["slack-groups"] });
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

/**
 * Hook for deleting entry points with optimistic updates.
 * Immediately removes the entry point from cache, rolls back on error.
 */
export function useDeleteEntryPoint(options?: { onSuccess?: () => void; onError?: () => void }) {
	const queryClient = useQueryClient();

	const deleteEntryPointFn = useServerFn(deleteEntryPoint);

	return useMutation(() => ({
		mutationFn: (id: string) => deleteEntryPointFn({ data: { id } }),

		onMutate: async (id) => {
			await queryClient.cancelQueries({ queryKey: ["entry-points"] });

			const previousEntryPoints = queryClient.getQueryData<EntryPoint[]>(["entry-points"]);

			queryClient.setQueryData<EntryPoint[]>(["entry-points"], (old) => old?.filter((ep) => ep.id !== id));

			return { previousEntryPoints };
		},

		onSuccess: () => {
			options?.onSuccess?.();
			queryClient.invalidateQueries({ queryKey: ["entry-points"] });
			queryClient.invalidateQueries({ queryKey: ["slack-users"] });
			queryClient.invalidateQueries({ queryKey: ["slack-groups"] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previousEntryPoints) {
				queryClient.setQueryData(["entry-points"], context.previousEntryPoints);
			}
			options?.onError?.();
		},
	}));
}

/**
 * Hook for updating entry point prompts with optimistic updates.
 * Immediately updates the prompt in cache, rolls back on error.
 */
export function useUpdateEntryPointPrompt(options?: { onSuccess?: () => void; onError?: () => void }) {
	const queryClient = useQueryClient();

	const updateEntryPointPromptFn = useServerFn(updateEntryPointPrompt);

	return useMutation(() => ({
		mutationFn: (data: { id: string; prompt: string }) => updateEntryPointPromptFn({ data }),

		onMutate: async ({ id, prompt }) => {
			await queryClient.cancelQueries({ queryKey: ["entry-points"] });

			const previousEntryPoints = queryClient.getQueryData<EntryPoint[]>(["entry-points"]);

			queryClient.setQueryData<EntryPoint[]>(["entry-points"], (old) => old?.map((ep) => (ep.id === id ? { ...ep, prompt } : ep)));

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

/**
 * Helper to create mutation input from Slack user
 */
export function toCreateInput(user: SlackUser) {
	return {
		id: user.id,
		type: "slack-user" as const,
		optimisticData: { name: user.name, avatar: user.avatar },
	};
}

/**
 * Helper to create mutation input from Slack user group
 */
export function toCreateGroupInput(group: SlackUserGroup) {
	return {
		id: group.id,
		type: "slack-user-group" as const,
		optimisticData: { name: group.handle },
	};
}
