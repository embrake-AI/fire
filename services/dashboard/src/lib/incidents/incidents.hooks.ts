import type { IS, IS_Event } from "@fire/common";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { useServerFn } from "@tanstack/solid-start";
import type { Accessor } from "solid-js";
import { getIncidents, updateAssignee, updateSeverity, updateStatus } from "./incidents";

export function useIncidents() {
	const getIncidentsFn = useServerFn(getIncidents);

	return useQuery(() => ({
		queryKey: ["incidents"],
		queryFn: getIncidentsFn,
		refetchInterval: 10_000,
		staleTime: 10_000,
	}));
}

type Incident = { state: IS; events: IS_Event[] };

export function useUpdateIncidentSeverity(incidentId: Accessor<string>, options?: { onSuccess?: () => void; onError?: () => void }) {
	const queryClient = useQueryClient();

	const updateSeverityFn = useServerFn(updateSeverity);

	return useMutation(() => ({
		mutationFn: async (severity: IS["severity"]) => updateSeverityFn({ data: { id: incidentId(), severity } }),

		onMutate: async (severity) => {
			await queryClient.cancelQueries({ queryKey: ["incident", incidentId()] });

			const previousIncident = queryClient.getQueryData<Incident>(["incident", incidentId()]);
			queryClient.setQueryData(["incident", incidentId()], { ...previousIncident, state: { ...previousIncident?.state, severity } });

			return { previousIncident };
		},

		onSuccess: () => {
			options?.onSuccess?.();
			queryClient.invalidateQueries({ queryKey: ["incident", incidentId()] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previousIncident) {
				queryClient.setQueryData(["incident", incidentId()], context.previousIncident);
			}
			options?.onError?.();
		},
	}));
}

export function useUpdateIncidentAssignee(incidentId: Accessor<string>, options?: { onSuccess?: () => void; onError?: () => void }) {
	const queryClient = useQueryClient();

	const updateAssigneeFn = useServerFn(updateAssignee);

	return useMutation(() => ({
		mutationFn: async (slackId: string) => updateAssigneeFn({ data: { id: incidentId(), slackId } }),

		onMutate: async (assignee) => {
			await queryClient.cancelQueries({ queryKey: ["incident", incidentId()] });

			const previousIncident = queryClient.getQueryData<Incident>(["incident", incidentId()]);
			queryClient.setQueryData(["incident", incidentId()], { ...previousIncident, state: { ...previousIncident?.state, assignee: { slackId: assignee } } });

			return { previousIncident };
		},

		onSuccess: () => {
			options?.onSuccess?.();
			queryClient.invalidateQueries({ queryKey: ["incident", incidentId()] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previousIncident) {
				queryClient.setQueryData(["incident", incidentId()], context.previousIncident);
			}
			options?.onError?.();
		},
	}));
}

export function useUpdateIncidentStatus(incidentId: Accessor<string>, options?: { onSuccess?: (status: "mitigating" | "resolved") => void; onError?: () => void }) {
	const queryClient = useQueryClient();

	const updateStatusFn = useServerFn(updateStatus);

	return useMutation(() => ({
		mutationFn: async ({ status, message }: { status: "mitigating" | "resolved"; message: string }) => updateStatusFn({ data: { id: incidentId(), status, message } }),

		onMutate: async ({ status }) => {
			await queryClient.cancelQueries({ queryKey: ["incident", incidentId()] });

			const previousIncident = queryClient.getQueryData<Incident>(["incident", incidentId()]);
			queryClient.setQueryData(["incident", incidentId()], { ...previousIncident, state: { ...previousIncident?.state, status } });

			return { previousIncident };
		},

		onSuccess: (_data, variables) => {
			options?.onSuccess?.(variables.status);
			queryClient.invalidateQueries({ queryKey: ["incident", incidentId()] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previousIncident) {
				queryClient.setQueryData(["incident", incidentId()], context.previousIncident);
			}
			options?.onError?.();
		},
	}));
}
