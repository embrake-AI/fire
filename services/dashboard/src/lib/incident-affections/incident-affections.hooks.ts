import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { useServerFn } from "@tanstack/solid-start";
import type { Accessor } from "solid-js";
import {
	type AddIncidentAffectionUpdateInput,
	addIncidentAffectionUpdate,
	type CreateIncidentAffectionInput,
	createIncidentAffection,
	getIncidentAffection,
	type IncidentAffectionData,
	type IncidentAffectionUpdateItem,
	type UpdateIncidentAffectionServicesInput,
	updateIncidentAffectionServices,
} from "./incident-affections";

export function useIncidentAffection(incidentId: Accessor<string>) {
	const getIncidentAffectionFn = useServerFn(getIncidentAffection);
	return useQuery(() => ({
		queryKey: ["incident-affection", incidentId()],
		queryFn: () => getIncidentAffectionFn({ data: { incidentId: incidentId() } }),
		staleTime: 10_000,
		refetchInterval: 10_000,
	}));
}

export function useCreateIncidentAffection(options?: { onSuccess?: () => void; onError?: () => void }) {
	const queryClient = useQueryClient();
	const createIncidentAffectionFn = useServerFn(createIncidentAffection);

	return useMutation(() => ({
		mutationFn: (data: CreateIncidentAffectionInput) => createIncidentAffectionFn({ data }),

		onSuccess: (_result, variables) => {
			queryClient.invalidateQueries({ queryKey: ["incident-affection", variables.incidentId] });
			options?.onSuccess?.();
		},

		onError: () => {
			options?.onError?.();
		},
	}));
}

export function useAddIncidentAffectionUpdate(incidentId: Accessor<string>, options?: { onSuccess?: () => void; onError?: () => void }) {
	const queryClient = useQueryClient();
	const addIncidentAffectionUpdateFn = useServerFn(addIncidentAffectionUpdate);

	return useMutation(() => ({
		mutationFn: (data: AddIncidentAffectionUpdateInput) => addIncidentAffectionUpdateFn({ data }),
		onMutate: (data) => {
			const queryKey = ["incident-affection", incidentId()];
			const previous = queryClient.getQueryData<IncidentAffectionData | null>(queryKey);
			if (!previous) return { previous };

			const optimisticUpdate: IncidentAffectionUpdateItem = {
				id: `optimistic-${Date.now()}`,
				status: data.status ?? null,
				message: data.message,
				createdAt: new Date(),
				createdBy: null,
			};

			queryClient.setQueryData<IncidentAffectionData | null>(queryKey, {
				...previous,
				currentStatus: data.status ?? previous.currentStatus,
				lastUpdate: optimisticUpdate,
				updatedAt: new Date(),
				resolvedAt: data.status === "resolved" ? new Date() : previous.resolvedAt,
			});

			return { previous };
		},

		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["incident-affection", incidentId()] });
			options?.onSuccess?.();
		},

		onError: (_error, _vars, context) => {
			if (context?.previous !== undefined) {
				queryClient.setQueryData(["incident-affection", incidentId()], context.previous);
			}
			options?.onError?.();
		},
	}));
}

export function useUpdateIncidentAffectionServices(incidentId: Accessor<string>, options?: { onSuccess?: () => void; onError?: () => void }) {
	const queryClient = useQueryClient();
	const updateIncidentAffectionServicesFn = useServerFn(updateIncidentAffectionServices);

	return useMutation(() => ({
		mutationFn: (data: UpdateIncidentAffectionServicesInput) => updateIncidentAffectionServicesFn({ data }),

		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["incident-affection", incidentId()] });
			options?.onSuccess?.();
		},

		onError: () => {
			options?.onError?.();
		},
	}));
}
