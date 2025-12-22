import type { IS } from "@fire/common";
import { useMutation, useQueryClient } from "@tanstack/solid-query";
import { useServerFn } from "@tanstack/solid-start";
import { updateAssignee, updateSeverity } from "./incidents";

/**
 * Hook for updating incident severity with optimistic updates.
 * Immediately updates the severity in cache, rolls back on error.
 */
export function useUpdateIncidentSeverity(incidentId: string, options?: { onSuccess?: () => void; onError?: () => void }) {
	const queryClient = useQueryClient();

	const updateSeverityFn = useServerFn(updateSeverity);

	return useMutation(() => ({
		mutationFn: async (severity: IS["severity"]) => {
			await updateSeverityFn({ data: { id: incidentId, severity } });
		},

		onMutate: async (severity) => {
			await queryClient.cancelQueries({ queryKey: ["incident", incidentId] });

			const previousIncident = queryClient.getQueryData<IS>(["incident", incidentId]);

			queryClient.setQueryData(["incident", incidentId], { ...previousIncident, severity });

			return { previousIncident };
		},

		onSuccess: () => {
			options?.onSuccess?.();
			queryClient.invalidateQueries({ queryKey: ["incident", incidentId] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previousIncident) {
				queryClient.setQueryData(["incident", incidentId], context.previousIncident);
			}
			options?.onError?.();
		},
	}));
}

/**
 * Hook for updating incident assignee with optimistic updates.
 * Immediately updates the assignee in cache, rolls back on error.
 */
export function useUpdateIncidentAssignee(incidentId: string, options?: { onSuccess?: () => void; onError?: () => void }) {
	const queryClient = useQueryClient();

	const updateAssigneeFn = useServerFn(updateAssignee);

	return useMutation(() => ({
		mutationFn: async (assignee: string) => {
			await updateAssigneeFn({ data: { id: incidentId, assignee } });
		},

		onMutate: async (assignee) => {
			await queryClient.cancelQueries({ queryKey: ["incident", incidentId] });

			const previousIncident = queryClient.getQueryData<IS>(["incident", incidentId]);

			queryClient.setQueryData(["incident", incidentId], { ...previousIncident, assignee });

			return { previousIncident };
		},

		onSuccess: () => {
			options?.onSuccess?.();
			queryClient.invalidateQueries({ queryKey: ["incident", incidentId] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previousIncident) {
				queryClient.setQueryData(["incident", incidentId], context.previousIncident);
			}
			options?.onError?.();
		},
	}));
}
