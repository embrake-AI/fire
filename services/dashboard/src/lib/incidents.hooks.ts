import type { IS } from "@fire/common";
import { useMutation, useQueryClient } from "@tanstack/solid-query";
import { useServerFn } from "@tanstack/solid-start";
import { updateAssignee, updateSeverity, updateStatus } from "./incidents";

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

/**
 * Hook for updating incident status with optimistic updates.
 * Immediately updates the status in cache, rolls back on error.
 * On resolved, also invalidates the incidents list.
 */
export function useUpdateIncidentStatus(incidentId: string, options?: { onSuccess?: (status: "mitigating" | "resolved") => void; onError?: () => void }) {
	const queryClient = useQueryClient();

	const updateStatusFn = useServerFn(updateStatus);

	return useMutation(() => ({
		mutationFn: async ({ status, message }: { status: "mitigating" | "resolved"; message: string }) => {
			return await updateStatusFn({ data: { id: incidentId, status, message } });
		},

		onMutate: async ({ status }) => {
			await queryClient.cancelQueries({ queryKey: ["incident", incidentId] });

			const previousIncident = queryClient.getQueryData<IS>(["incident", incidentId]);

			queryClient.setQueryData(["incident", incidentId], { ...previousIncident, status });

			return { previousIncident };
		},

		onSuccess: (data) => {
			if (data.status === "mitigating" || data.status === "resolved") {
				options?.onSuccess?.(data.status);
				queryClient.invalidateQueries({ queryKey: ["incident", incidentId] });
			}
		},

		onError: (_err, _variables, context) => {
			if (context?.previousIncident) {
				queryClient.setQueryData(["incident", incidentId], context.previousIncident);
			}
			options?.onError?.();
		},
	}));
}
