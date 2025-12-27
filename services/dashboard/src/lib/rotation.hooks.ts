import type { SHIFT_LENGTH_OPTIONS } from "@fire/common";
import { useMutation, useQueryClient } from "@tanstack/solid-query";
import { useServerFn } from "@tanstack/solid-start";
import type { getRotations } from "./rotation";
import {
	addRotationAssignee,
	clearRotationOverride,
	createRotation,
	deleteRotation,
	removeRotationAssignee,
	reorderRotationAssignee,
	setRotationOverride,
	updateRotationName,
	updateRotationShiftLength,
} from "./rotation";

type GetRotationsResponse = Awaited<ReturnType<typeof getRotations>>;

type ShiftLength = (typeof SHIFT_LENGTH_OPTIONS)[number]["value"];
export function useCreateRotation(options?: { onMutate?: (tempId: string) => void; onSuccess?: (realId: string) => void; onError?: () => void }) {
	const queryClient = useQueryClient();
	const createRotationFn = useServerFn(createRotation);

	return useMutation(() => ({
		mutationFn: (data: { name: string; shiftLength: ShiftLength; anchorAt?: Date }) => createRotationFn({ data }),

		onMutate: async (newData) => {
			await queryClient.cancelQueries({ queryKey: ["rotations"] });

			const previousRotations = queryClient.getQueryData<GetRotationsResponse>(["rotations"]);

			const tempId = `temp-${Date.now()}`;

			const optimisticRotation = {
				id: tempId,
				name: newData.name,
				shiftLength: newData.shiftLength,
				assignees: [],
				createdAt: new Date(),
				isInUse: false,
				currentAssignee: tempId,
			};

			queryClient.setQueryData<GetRotationsResponse>(["rotations"], (old) => [optimisticRotation, ...(old ?? [])]);

			options?.onMutate?.(tempId);

			return { previousRotations, tempId };
		},

		onSuccess: (newRotation, _variables, context) => {
			if (newRotation?.id && context?.tempId) {
				queryClient.setQueryData<GetRotationsResponse>(["rotations"], (old) => old?.map((r) => (r.id === context.tempId ? { ...r, id: newRotation.id } : r)));
				options?.onSuccess?.(newRotation.id);
			}
			queryClient.invalidateQueries({ queryKey: ["rotations"] });
			queryClient.invalidateQueries({ queryKey: ["rotations-for-entry-points"] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previousRotations) {
				queryClient.setQueryData(["rotations"], context.previousRotations);
			}
			options?.onError?.();
		},
	}));
}

export function useDeleteRotation(options?: { onSuccess?: () => void; onError?: () => void }) {
	const queryClient = useQueryClient();
	const deleteRotationFn = useServerFn(deleteRotation);

	return useMutation(() => ({
		mutationFn: (id: string) => deleteRotationFn({ data: { id } }),

		onMutate: async (id) => {
			await queryClient.cancelQueries({ queryKey: ["rotations"] });

			const previousRotations = queryClient.getQueryData<GetRotationsResponse>(["rotations"]);

			queryClient.setQueryData<GetRotationsResponse>(["rotations"], (old) => old?.filter((r) => r.id !== id));

			return { previousRotations };
		},

		onSuccess: () => {
			options?.onSuccess?.();
			queryClient.invalidateQueries({ queryKey: ["rotations"] });
			queryClient.invalidateQueries({ queryKey: ["rotations-for-entry-points"] });
			queryClient.invalidateQueries({ queryKey: ["entry-points"] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previousRotations) {
				queryClient.setQueryData(["rotations"], context.previousRotations);
			}
			options?.onError?.();
		},
	}));
}

export function useUpdateRotationName(options?: { onSuccess?: () => void; onError?: () => void }) {
	const queryClient = useQueryClient();
	const updateRotationNameFn = useServerFn(updateRotationName);

	return useMutation(() => ({
		mutationFn: (data: { id: string; name: string }) => updateRotationNameFn({ data }),

		onMutate: async ({ id, name }) => {
			await queryClient.cancelQueries({ queryKey: ["rotations"] });

			const previousRotations = queryClient.getQueryData<GetRotationsResponse>(["rotations"]);

			queryClient.setQueryData<GetRotationsResponse>(["rotations"], (old) => old?.map((r) => (r.id === id ? { ...r, name } : r)));

			return { previousRotations };
		},

		onSuccess: () => {
			options?.onSuccess?.();
			queryClient.invalidateQueries({ queryKey: ["rotations"] });
			queryClient.invalidateQueries({ queryKey: ["rotations-for-entry-points"] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previousRotations) {
				queryClient.setQueryData(["rotations"], context.previousRotations);
			}
			options?.onError?.();
		},
	}));
}

export function useUpdateRotationShiftLength(options?: { onSuccess?: () => void; onError?: () => void }) {
	const queryClient = useQueryClient();
	const updateRotationShiftLengthFn = useServerFn(updateRotationShiftLength);

	return useMutation(() => ({
		mutationFn: (data: { id: string; shiftLength: string }) => updateRotationShiftLengthFn({ data }),

		onMutate: async ({ id, shiftLength }) => {
			await queryClient.cancelQueries({ queryKey: ["rotations"] });

			const previousRotations = queryClient.getQueryData<GetRotationsResponse>(["rotations"]);

			queryClient.setQueryData<GetRotationsResponse>(["rotations"], (old) => old?.map((r) => (r.id === id ? { ...r, shiftLength } : r)));

			return { previousRotations };
		},

		onSuccess: () => {
			options?.onSuccess?.();
			queryClient.invalidateQueries({ queryKey: ["rotations"] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previousRotations) {
				queryClient.setQueryData(["rotations"], context.previousRotations);
			}
			options?.onError?.();
		},
	}));
}

export function useAddRotationAssignee(options?: { onSuccess?: () => void; onError?: () => void }) {
	const queryClient = useQueryClient();
	const addRotationAssigneeFn = useServerFn(addRotationAssignee);

	return useMutation(() => ({
		mutationFn: (data: { rotationId: string; assigneeId: string; optimisticData: { name?: string; avatar?: string } }) =>
			addRotationAssigneeFn({ data: { rotationId: data.rotationId, assigneeId: data.assigneeId } }),

		onMutate: async ({ rotationId, assigneeId, optimisticData }) => {
			await queryClient.cancelQueries({ queryKey: ["rotations"] });

			const previousRotations = queryClient.getQueryData<GetRotationsResponse>(["rotations"]);

			queryClient.setQueryData<GetRotationsResponse>(["rotations"], (old) =>
				old?.map((r) => {
					if (r.id !== rotationId) return r;
					if (r.assignees.some((a) => a.id === assigneeId)) return r;
					return {
						...r,
						assignees: [...r.assignees, { id: assigneeId, name: optimisticData.name, avatar: optimisticData.avatar, isBaseAssignee: false, isOverride: false }],
					};
				}),
			);

			return { previousRotations };
		},

		onSuccess: () => {
			options?.onSuccess?.();
			queryClient.invalidateQueries({ queryKey: ["rotations"] });
			queryClient.invalidateQueries({ queryKey: ["rotations-for-entry-points"] });
			queryClient.invalidateQueries({ queryKey: ["slack-users"] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previousRotations) {
				queryClient.setQueryData(["rotations"], context.previousRotations);
			}
			options?.onError?.();
		},
	}));
}

export function useRemoveRotationAssignee(options?: { onSuccess?: () => void; onError?: () => void }) {
	const queryClient = useQueryClient();
	const removeRotationAssigneeFn = useServerFn(removeRotationAssignee);

	return useMutation(() => ({
		mutationFn: (data: { rotationId: string; assigneeId: string }) => removeRotationAssigneeFn({ data }),

		onMutate: async ({ rotationId, assigneeId }) => {
			await queryClient.cancelQueries({ queryKey: ["rotations"] });

			const previousRotations = queryClient.getQueryData<GetRotationsResponse>(["rotations"]);

			queryClient.setQueryData<GetRotationsResponse>(["rotations"], (old) =>
				old?.map((r) => {
					if (r.id !== rotationId) return r;
					return {
						...r,
						assignees: r.assignees.filter((a) => a.id !== assigneeId),
					};
				}),
			);

			return { previousRotations };
		},

		onSuccess: () => {
			options?.onSuccess?.();
			queryClient.invalidateQueries({ queryKey: ["rotations"] });
			queryClient.invalidateQueries({ queryKey: ["rotations-for-entry-points"] });
			queryClient.invalidateQueries({ queryKey: ["slack-users"] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previousRotations) {
				queryClient.setQueryData(["rotations"], context.previousRotations);
			}
			options?.onError?.();
		},
	}));
}

export function useSetRotationOverride(options?: { onSuccess?: () => void; onError?: () => void }) {
	const queryClient = useQueryClient();
	const setRotationOverrideFn = useServerFn(setRotationOverride);

	return useMutation(() => ({
		mutationFn: (data: { rotationId: string; assigneeId: string }) => setRotationOverrideFn({ data }),

		onMutate: async ({ rotationId, assigneeId }) => {
			await queryClient.cancelQueries({ queryKey: ["rotations"] });

			const previousRotations = queryClient.getQueryData<GetRotationsResponse>(["rotations"]);

			queryClient.setQueryData<GetRotationsResponse>(["rotations"], (old) =>
				old?.map((r) => {
					if (r.id !== rotationId) return r;
					return {
						...r,
						assignees: r.assignees.map((a) => ({
							...a,
							isOverride: a.id === assigneeId,
						})),
					};
				}),
			);

			return { previousRotations };
		},

		onSuccess: () => {
			options?.onSuccess?.();
			queryClient.invalidateQueries({ queryKey: ["rotations"] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previousRotations) {
				queryClient.setQueryData(["rotations"], context.previousRotations);
			}
			options?.onError?.();
		},
	}));
}

export function useClearRotationOverride(options?: { onSuccess?: () => void; onError?: () => void }) {
	const queryClient = useQueryClient();
	const clearRotationOverrideFn = useServerFn(clearRotationOverride);

	return useMutation(() => ({
		mutationFn: (data: { rotationId: string }) => clearRotationOverrideFn({ data }),

		onMutate: async ({ rotationId }) => {
			await queryClient.cancelQueries({ queryKey: ["rotations"] });

			const previousRotations = queryClient.getQueryData<GetRotationsResponse>(["rotations"]);

			queryClient.setQueryData<GetRotationsResponse>(["rotations"], (old) =>
				old?.map((r) => {
					if (r.id !== rotationId) return r;
					return {
						...r,
						assignees: r.assignees.map((a) => ({
							...a,
							isOverride: false,
						})),
					};
				}),
			);

			return { previousRotations };
		},

		onSuccess: () => {
			options?.onSuccess?.();
			queryClient.invalidateQueries({ queryKey: ["rotations"] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previousRotations) {
				queryClient.setQueryData(["rotations"], context.previousRotations);
			}
			options?.onError?.();
		},
	}));
}

export function useReorderRotationAssignee(options?: { onSuccess?: () => void; onError?: () => void }) {
	const queryClient = useQueryClient();
	const reorderRotationAssigneeFn = useServerFn(reorderRotationAssignee);

	return useMutation(() => ({
		mutationFn: (data: { rotationId: string; assigneeId: string; newPosition: number }) => reorderRotationAssigneeFn({ data }),

		onMutate: async ({ rotationId, assigneeId, newPosition }) => {
			await queryClient.cancelQueries({ queryKey: ["rotations"] });

			const previousRotations = queryClient.getQueryData<GetRotationsResponse>(["rotations"]);

			queryClient.setQueryData<GetRotationsResponse>(["rotations"], (old) =>
				old?.map((r) => {
					if (r.id !== rotationId) return r;

					const currentIndex = r.assignees.findIndex((a) => a.id === assigneeId);
					if (currentIndex === -1) return r;

					const newAssignees = [...r.assignees];
					const [moved] = newAssignees.splice(currentIndex, 1);

					const insertAt = Math.max(0, Math.min(newPosition, newAssignees.length));
					newAssignees.splice(insertAt, 0, moved);

					const updatedAssignees = newAssignees.map((a, idx) => ({
						...a,
						isBaseAssignee: idx === 0,
					}));

					return {
						...r,
						assignees: updatedAssignees,
					};
				}),
			);

			return { previousRotations };
		},

		onSuccess: () => {
			options?.onSuccess?.();
			queryClient.invalidateQueries({ queryKey: ["rotations"] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previousRotations) {
				queryClient.setQueryData(["rotations"], context.previousRotations);
			}
			options?.onError?.();
		},
	}));
}

export function toAddAssigneeInput(rotationId: string, user: { id: string; name?: string; avatar?: string }) {
	return {
		rotationId,
		assigneeId: user.id,
		optimisticData: { name: user.name, avatar: user.avatar },
	};
}
