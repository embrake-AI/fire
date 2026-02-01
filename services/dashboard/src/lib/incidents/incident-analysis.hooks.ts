import { useMutation, useQueryClient } from "@tanstack/solid-query";
import { useServerFn } from "@tanstack/solid-start";
import type { Accessor } from "solid-js";
import { createIncidentAction, deleteIncidentAction, updateAnalysisImpact, updateAnalysisRootCause, updateAnalysisTimeline, updateIncidentAction } from "./incident-analysis";
import type { IncidentAnalysis } from "./incidents";

export function useUpdateAnalysisImpact(incidentId: Accessor<string>) {
	const queryClient = useQueryClient();
	const updateFn = useServerFn(updateAnalysisImpact);

	return useMutation(() => ({
		mutationFn: async (impact: string) => updateFn({ data: { id: incidentId(), impact } }),

		onMutate: async (impact) => {
			await queryClient.cancelQueries({ queryKey: ["analysis", incidentId()] });
			const previous = queryClient.getQueryData<IncidentAnalysis>(["analysis", incidentId()]);
			if (previous) {
				queryClient.setQueryData(["analysis", incidentId()], { ...previous, impact: impact.trim() || null });
			}
			return { previous };
		},

		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["analysis", incidentId()] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previous) {
				queryClient.setQueryData(["analysis", incidentId()], context.previous);
			}
		},
	}));
}

export function useUpdateAnalysisRootCause(incidentId: Accessor<string>) {
	const queryClient = useQueryClient();
	const updateFn = useServerFn(updateAnalysisRootCause);

	return useMutation(() => ({
		mutationFn: async (rootCause: string) => updateFn({ data: { id: incidentId(), rootCause } }),

		onMutate: async (rootCause) => {
			await queryClient.cancelQueries({ queryKey: ["analysis", incidentId()] });
			const previous = queryClient.getQueryData<IncidentAnalysis>(["analysis", incidentId()]);
			if (previous) {
				queryClient.setQueryData(["analysis", incidentId()], { ...previous, rootCause: rootCause.trim() || null });
			}
			return { previous };
		},

		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["analysis", incidentId()] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previous) {
				queryClient.setQueryData(["analysis", incidentId()], context.previous);
			}
		},
	}));
}

export function useUpdateAnalysisTimeline(incidentId: Accessor<string>) {
	const queryClient = useQueryClient();
	const updateFn = useServerFn(updateAnalysisTimeline);

	return useMutation(() => ({
		mutationFn: async (timeline: { created_at: string; text: string }[]) => updateFn({ data: { id: incidentId(), timeline } }),

		onMutate: async (timeline) => {
			await queryClient.cancelQueries({ queryKey: ["analysis", incidentId()] });
			const previous = queryClient.getQueryData<IncidentAnalysis>(["analysis", incidentId()]);
			if (previous) {
				queryClient.setQueryData(["analysis", incidentId()], { ...previous, timeline: timeline.length ? timeline : null });
			}
			return { previous };
		},

		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["analysis", incidentId()] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previous) {
				queryClient.setQueryData(["analysis", incidentId()], context.previous);
			}
		},
	}));
}

export function useUpdateIncidentAction(incidentId: Accessor<string>) {
	const queryClient = useQueryClient();
	const updateFn = useServerFn(updateIncidentAction);

	return useMutation(() => ({
		mutationFn: async ({ id, description }: { id: string; description: string }) => updateFn({ data: { id, description } }),

		onMutate: async ({ id, description }) => {
			await queryClient.cancelQueries({ queryKey: ["analysis", incidentId()] });
			const previous = queryClient.getQueryData<IncidentAnalysis>(["analysis", incidentId()]);
			if (previous) {
				const actions = previous.actions.map((a) => (a.id === id ? { ...a, description: description.trim() } : a));
				queryClient.setQueryData(["analysis", incidentId()], { ...previous, actions });
			}
			return { previous };
		},

		onError: (_err, _variables, context) => {
			if (context?.previous) {
				queryClient.setQueryData(["analysis", incidentId()], context.previous);
			}
		},
	}));
}

export function useDeleteIncidentAction(incidentId: Accessor<string>) {
	const queryClient = useQueryClient();
	const deleteFn = useServerFn(deleteIncidentAction);

	return useMutation(() => ({
		mutationFn: async (id: string) => deleteFn({ data: { id } }),

		onMutate: async (id) => {
			await queryClient.cancelQueries({ queryKey: ["analysis", incidentId()] });
			const previous = queryClient.getQueryData<IncidentAnalysis>(["analysis", incidentId()]);
			if (previous) {
				const actions = previous.actions.filter((a) => a.id !== id);
				queryClient.setQueryData(["analysis", incidentId()], { ...previous, actions });
			}
			return { previous };
		},

		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["analysis", incidentId()] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previous) {
				queryClient.setQueryData(["analysis", incidentId()], context.previous);
			}
		},
	}));
}

export function useCreateIncidentAction(incidentId: Accessor<string>) {
	const queryClient = useQueryClient();
	const createFn = useServerFn(createIncidentAction);

	return useMutation(() => ({
		mutationFn: async (description: string) => createFn({ data: { incidentId: incidentId(), description } }),

		onMutate: async (description) => {
			await queryClient.cancelQueries({ queryKey: ["analysis", incidentId()] });
			const previous = queryClient.getQueryData<IncidentAnalysis>(["analysis", incidentId()]);
			if (previous) {
				const tempId = `temp-${Date.now()}`;
				const actions = [...previous.actions, { id: tempId, description: description.trim() }];
				queryClient.setQueryData(["analysis", incidentId()], { ...previous, actions });
			}
			return { previous };
		},

		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["analysis", incidentId()] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previous) {
				queryClient.setQueryData(["analysis", incidentId()], context.previous);
			}
		},
	}));
}
