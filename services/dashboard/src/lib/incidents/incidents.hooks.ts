import type { IS, IS_Event } from "@fire/common";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { useServerFn } from "@tanstack/solid-start";
import type { Accessor } from "solid-js";
import { runDemoAware } from "../demo/runtime";
import { getIncidentsDemo, updateAssigneeDemo, updateSeverityDemo, updateStatusDemo } from "../demo/store";
import { getIncidents, updateAssignee, updateSeverity, updateStatus } from "./incidents";

type UseIncidentsOptions = {
	enabled?: Accessor<boolean>;
	placeholderData?: Awaited<ReturnType<typeof getIncidents>>;
};

export function useIncidents(options?: UseIncidentsOptions) {
	const getIncidentsFn = useServerFn(getIncidents);

	return useQuery(() => ({
		queryKey: ["incidents"],
		queryFn: () =>
			runDemoAware({
				demo: () => getIncidentsDemo(),
				remote: () => getIncidentsFn(),
			}),
		refetchInterval: 10_000,
		staleTime: 10_000,
		enabled: options?.enabled?.() ?? true,
		placeholderData: options?.placeholderData,
	}));
}

type Incident = { state: IS; events: IS_Event[] };

export function useUpdateIncidentSeverity(incidentId: Accessor<string>, options?: { onSuccess?: () => void; onError?: () => void }) {
	const queryClient = useQueryClient();

	const updateSeverityFn = useServerFn(updateSeverity);

	return useMutation(() => ({
		mutationFn: async (severity: IS["severity"]) =>
			runDemoAware({
				demo: () => updateSeverityDemo({ id: incidentId(), severity }),
				remote: () => updateSeverityFn({ data: { id: incidentId(), severity } }),
			}),

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
		mutationFn: async (slackId: string) =>
			runDemoAware({
				demo: () => updateAssigneeDemo({ id: incidentId(), slackId }),
				remote: () => updateAssigneeFn({ data: { id: incidentId(), slackId } }),
			}),

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
		mutationFn: async ({ status, message }: { status: "mitigating" | "resolved"; message: string }) =>
			runDemoAware({
				demo: () => updateStatusDemo({ id: incidentId(), status, message }),
				remote: () => updateStatusFn({ data: { id: incidentId(), status, message } }),
			}),

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
