import type { IS, IS_Event } from "@fire/common";
import { useMutation, useQueryClient } from "@tanstack/solid-query";
import { useServerFn } from "@tanstack/solid-start";
import { updateAssignee, updateSeverity, updateStatus } from "./incidents";

type Incident = { state: IS; events: IS_Event[] };

/**
 * Hook for updating incident severity with optimistic updates.
 * Immediately updates the severity in cache, rolls back on error.
 */
export function useUpdateIncidentSeverity(incidentId: string, options?: { onSuccess?: () => void; onError?: () => void }) {
	const queryClient = useQueryClient();

	const updateSeverityFn = useServerFn(updateSeverity);

	return useMutation(() => ({
		mutationFn: async (severity: IS["severity"]) => updateSeverityFn({ data: { id: incidentId, severity } }),

		onMutate: async (severity) => {
			await queryClient.cancelQueries({ queryKey: ["incident", incidentId] });

			const previousIncident = queryClient.getQueryData<Incident>(["incident", incidentId]);
			queryClient.setQueryData(["incident", incidentId], { ...previousIncident, state: { ...previousIncident?.state, severity } });

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
		mutationFn: async (assignee: string) => updateAssigneeFn({ data: { id: incidentId, assignee } }),

		onMutate: async (assignee) => {
			await queryClient.cancelQueries({ queryKey: ["incident", incidentId] });

			const previousIncident = queryClient.getQueryData<Incident>(["incident", incidentId]);
			queryClient.setQueryData(["incident", incidentId], { ...previousIncident, state: { ...previousIncident?.state, assignee } });

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
		mutationFn: async ({ status, message }: { status: "mitigating" | "resolved"; message: string }) => updateStatusFn({ data: { id: incidentId, status, message } }),

		onMutate: async ({ status }) => {
			await queryClient.cancelQueries({ queryKey: ["incident", incidentId] });

			const previousIncident = queryClient.getQueryData<Incident>(["incident", incidentId]);
			queryClient.setQueryData(["incident", incidentId], { ...previousIncident, state: { ...previousIncident?.state, status } });

			return { previousIncident };
		},

		onSuccess: (_data, variables) => {
			options?.onSuccess?.(variables.status);
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
