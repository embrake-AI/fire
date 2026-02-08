import type { SHIFT_LENGTH_OPTIONS } from "@fire/common";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { useServerFn } from "@tanstack/solid-start";
import type { Accessor } from "solid-js";
import type { getUsers } from "../users/users";
import {
	addRotationAssignee,
	addSlackUserAsRotationAssignee,
	clearRotationOverride,
	createRotation,
	createRotationOverride,
	deleteRotation,
	getRotationOverrides,
	getRotations,
	removeRotationAssignee,
	reorderRotationAssignee,
	setRotationOverride,
	updateRotationAnchor,
	updateRotationName,
	updateRotationOverride,
	updateRotationShiftLength,
	updateRotationSlackChannel,
	updateRotationTeam,
} from "./rotations";

type GetRotationsResponse = Awaited<ReturnType<typeof getRotations>>;
type GetRotationOverridesResponse = Awaited<ReturnType<typeof getRotationOverrides>>;
type GetUsersResponse = Awaited<ReturnType<typeof getUsers>>;

type OverrideCacheEntry = [readonly unknown[], GetRotationOverridesResponse | undefined];

const sortOverrides = (overrides: GetRotationOverridesResponse) => {
	return [...overrides].sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
};

const getOverrideRangeFromKey = (key: readonly unknown[]) => {
	const startIso = key[2];
	const endIso = key[3];
	if (typeof startIso !== "string" || typeof endIso !== "string") return null;
	const start = new Date(startIso);
	const end = new Date(endIso);
	if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
	return { start, end };
};

const updateOverridesCache = (queryClient: ReturnType<typeof useQueryClient>, rotationId: string, updater: (entry: OverrideCacheEntry) => GetRotationOverridesResponse) => {
	const entries = queryClient.getQueriesData<GetRotationOverridesResponse>({ queryKey: ["rotation-overrides", rotationId] }) as OverrideCacheEntry[];
	for (const entry of entries) {
		queryClient.setQueryData(entry[0], updater(entry));
	}
	return entries;
};

export function useRotations(options?: { enabled?: Accessor<boolean> }) {
	const getRotationsFn = useServerFn(getRotations);
	return useQuery(() => ({
		queryKey: ["rotations"],
		queryFn: getRotationsFn,
		staleTime: 60_000,
		enabled: options?.enabled?.() ?? true,
	}));
}

type ShiftLength = (typeof SHIFT_LENGTH_OPTIONS)[number]["value"];
export function useCreateRotation(options?: { onMutate?: (tempId: string) => void; onSuccess?: (realId: string) => void; onError?: () => void }) {
	const queryClient = useQueryClient();
	const createRotationFn = useServerFn(createRotation);

	return useMutation(() => ({
		mutationFn: (data: { name: string; shiftLength: ShiftLength; anchorAt?: Date; teamId?: string }) => createRotationFn({ data }),

		onMutate: async (newData) => {
			await queryClient.cancelQueries({ queryKey: ["rotations"] });

			const previousRotations = queryClient.getQueryData<GetRotationsResponse>(["rotations"]);

			const tempId = `temp-${Date.now()}`;

			const optimisticRotation = {
				id: tempId,
				name: newData.name,
				slackChannelId: null,
				shiftStart: new Date(),
				shiftLength: newData.shiftLength,
				assignees: [],
				createdAt: new Date(),
				isInUse: false,
				currentAssignee: tempId,
				currentOverrideId: null,
				teamId: newData.teamId ?? null,
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

export function useUpdateRotationName(options?: { onMutate?: () => void; onSuccess?: () => void; onError?: () => void }) {
	const queryClient = useQueryClient();
	const updateRotationNameFn = useServerFn(updateRotationName);

	return useMutation(() => ({
		mutationFn: (data: { id: string; name: string }) => updateRotationNameFn({ data }),

		onMutate: async ({ id, name }) => {
			await queryClient.cancelQueries({ queryKey: ["rotations"] });

			const previousRotations = queryClient.getQueryData<GetRotationsResponse>(["rotations"]);

			queryClient.setQueryData<GetRotationsResponse>(["rotations"], (old) => old?.map((r) => (r.id === id ? { ...r, name } : r)));

			options?.onMutate?.();

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

export function useUpdateRotationTeam(options?: { onMutate?: () => void; onSuccess?: () => void; onError?: () => void }) {
	const queryClient = useQueryClient();
	const updateRotationTeamFn = useServerFn(updateRotationTeam);

	return useMutation(() => ({
		mutationFn: (data: { id: string; teamId: string | null }) => updateRotationTeamFn({ data }),

		onMutate: async ({ id, teamId }) => {
			await queryClient.cancelQueries({ queryKey: ["rotations"] });

			const previousRotations = queryClient.getQueryData<GetRotationsResponse>(["rotations"]);

			queryClient.setQueryData<GetRotationsResponse>(["rotations"], (old) => old?.map((r) => (r.id === id ? { ...r, teamId } : r)));

			options?.onMutate?.();

			return { previousRotations };
		},

		onSuccess: () => {
			options?.onSuccess?.();
			queryClient.invalidateQueries({ queryKey: ["rotations"] });
			queryClient.invalidateQueries({ queryKey: ["teams"] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previousRotations) {
				queryClient.setQueryData(["rotations"], context.previousRotations);
			}
			options?.onError?.();
		},
	}));
}

export function useUpdateRotationSlackChannel(options?: { onMutate?: () => void; onSuccess?: () => void; onError?: () => void }) {
	const queryClient = useQueryClient();
	const updateRotationSlackChannelFn = useServerFn(updateRotationSlackChannel);

	return useMutation(() => ({
		mutationFn: (data: { id: string; slackChannelId: string | null }) => updateRotationSlackChannelFn({ data }),

		onMutate: async ({ id, slackChannelId }) => {
			await queryClient.cancelQueries({ queryKey: ["rotations"] });

			const previousRotations = queryClient.getQueryData<GetRotationsResponse>(["rotations"]);

			queryClient.setQueryData<GetRotationsResponse>(["rotations"], (old) => old?.map((r) => (r.id === id ? { ...r, slackChannelId } : r)));

			options?.onMutate?.();

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

export function useUpdateRotationAnchor(options?: { onSuccess?: () => void; onError?: () => void }) {
	const queryClient = useQueryClient();
	const updateRotationAnchorFn = useServerFn(updateRotationAnchor);

	return useMutation(() => ({
		mutationFn: (data: { id: string; anchorAt: Date }) => updateRotationAnchorFn({ data }),

		onMutate: async ({ id, anchorAt }) => {
			await queryClient.cancelQueries({ queryKey: ["rotations"] });

			const previousRotations = queryClient.getQueryData<GetRotationsResponse>(["rotations"]);

			queryClient.setQueryData<GetRotationsResponse>(["rotations"], (old) => old?.map((r) => (r.id === id ? { ...r, shiftStart: anchorAt } : r)));

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
			queryClient.invalidateQueries({ queryKey: ["users"] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previousRotations) {
				queryClient.setQueryData(["rotations"], context.previousRotations);
			}
			options?.onError?.();
		},
	}));
}

export function useAddSlackUserAsRotationAssignee(options?: { onSuccess?: () => void; onError?: () => void }) {
	const queryClient = useQueryClient();
	const addSlackUserAsRotationAssigneeFn = useServerFn(addSlackUserAsRotationAssignee);

	return useMutation(() => ({
		mutationFn: (data: { rotationId: string; slackUserId: string; optimisticData: { name?: string; avatar?: string } }) =>
			addSlackUserAsRotationAssigneeFn({ data: { rotationId: data.rotationId, slackUserId: data.slackUserId } }),

		onMutate: async ({ rotationId, slackUserId, optimisticData }) => {
			await queryClient.cancelQueries({ queryKey: ["rotations"] });
			await queryClient.cancelQueries({ queryKey: ["users"] });

			const previousRotations = queryClient.getQueryData<GetRotationsResponse>(["rotations"]);
			const previousUsers = queryClient.getQueryData<GetUsersResponse>(["users"]);

			const tempUserId = `temp-slack-${slackUserId}`;

			queryClient.setQueryData<GetRotationsResponse>(["rotations"], (old) =>
				old?.map((r) => {
					if (r.id !== rotationId) return r;
					if (r.assignees.some((a) => a.id === tempUserId)) return r;
					return {
						...r,
						assignees: [...r.assignees, { id: tempUserId, name: optimisticData.name, avatar: optimisticData.avatar, isBaseAssignee: false, isOverride: false }],
					};
				}),
			);

			queryClient.setQueryData<GetUsersResponse>(["users"], (prev) => {
				if (prev?.some((user) => user.id === tempUserId)) return prev;
				return [
					...(prev ?? []),
					{
						id: tempUserId,
						name: optimisticData.name ?? "Slack user",
						email: "",
						image: optimisticData.avatar ?? null,
						teamIds: [],
						slackId: slackUserId,
					},
				];
			});

			return { previousRotations, previousUsers, tempUserId };
		},

		onSuccess: (newUser, variables) => {
			const tempUserId = `temp-slack-${variables.slackUserId}`;
			if (newUser?.userId) {
				queryClient.setQueryData<GetUsersResponse>(["users"], (prev) => prev?.map((user) => (user.id === tempUserId ? { ...user, id: newUser.userId } : user)));
				queryClient.setQueryData<GetRotationsResponse>(["rotations"], (old) =>
					old?.map((r) => {
						if (r.id !== variables.rotationId) return r;
						return {
							...r,
							assignees: r.assignees.map((a) => (a.id === tempUserId ? { ...a, id: newUser.userId } : a)),
						};
					}),
				);
			}
			options?.onSuccess?.();
			queryClient.invalidateQueries({ queryKey: ["rotations"] });
			queryClient.invalidateQueries({ queryKey: ["users"] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previousRotations) {
				queryClient.setQueryData(["rotations"], context.previousRotations);
			}
			if (context?.previousUsers) {
				queryClient.setQueryData(["users"], context.previousUsers);
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
			queryClient.invalidateQueries({ queryKey: ["users"] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previousRotations) {
				queryClient.setQueryData(["rotations"], context.previousRotations);
			}
			options?.onError?.();
		},
	}));
}

export function useRotationOverrides(options: { rotationId: Accessor<string | null>; startAt: Accessor<Date>; endAt: Accessor<Date>; enabled?: Accessor<boolean> }) {
	const getRotationOverridesFn = useServerFn(getRotationOverrides);

	return useQuery(() => {
		const rotationId = options.rotationId();
		const startAt = options.startAt();
		const endAt = options.endAt();

		return {
			queryKey: ["rotation-overrides", rotationId, startAt.toISOString(), endAt.toISOString()],
			queryFn: () => getRotationOverridesFn({ data: { rotationId: rotationId!, startAt, endAt } }),
			enabled: (options.enabled?.() ?? true) && !!rotationId,
			staleTime: 60_000,
			suspense: false,
			placeholderData: (previous) => previous ?? [],
		};
	});
}

export function useCreateRotationOverride(options?: { onSuccess?: () => void; onError?: () => void }) {
	const queryClient = useQueryClient();
	const createRotationOverrideFn = useServerFn(createRotationOverride);

	return useMutation(() => ({
		mutationFn: (data: { rotationId: string; assigneeId: string; startAt: Date; endAt: Date }) => createRotationOverrideFn({ data }),

		onMutate: async ({ rotationId, assigneeId, startAt, endAt }) => {
			await queryClient.cancelQueries({ queryKey: ["rotation-overrides", rotationId] });
			await queryClient.cancelQueries({ queryKey: ["rotations"] });

			const previousRotations = queryClient.getQueryData<GetRotationsResponse>(["rotations"]);
			const tempId = `temp-override-${Date.now()}`;
			const optimisticOverride = {
				id: tempId,
				assigneeId,
				startAt,
				endAt,
				createdAt: new Date(),
			};

			const previousOverrides = updateOverridesCache(queryClient, rotationId, ([key, data]) => {
				const range = getOverrideRangeFromKey(key);
				if (!range) return data ?? [];
				const intersects = startAt < range.end && endAt > range.start;
				if (!intersects) return data ?? [];
				return sortOverrides([...(data ?? []), optimisticOverride]);
			});

			const now = new Date();
			if (startAt <= now && endAt > now) {
				queryClient.setQueryData<GetRotationsResponse>(["rotations"], (old) =>
					old?.map((rotation) => {
						if (rotation.id !== rotationId) return rotation;
						return {
							...rotation,
							currentOverrideId: tempId,
							assignees: rotation.assignees.map((assignee) => ({
								...assignee,
								isOverride: assignee.id === assigneeId,
							})),
						};
					}),
				);
			}

			return { previousOverrides, previousRotations, tempId };
		},

		onSuccess: (result, variables, context) => {
			const newId = result?.id;
			if (newId && context?.tempId) {
				updateOverridesCache(queryClient, variables.rotationId, ([key, data]) => {
					const range = getOverrideRangeFromKey(key);
					if (!range) return data ?? [];
					return (data ?? []).map((override) => (override.id === context.tempId ? { ...override, id: newId } : override));
				});
				queryClient.setQueryData<GetRotationsResponse>(["rotations"], (old) =>
					old?.map((rotation) => {
						if (rotation.id !== variables.rotationId) return rotation;
						if (rotation.currentOverrideId !== context.tempId) return rotation;
						return {
							...rotation,
							currentOverrideId: newId,
						};
					}),
				);
			}

			queryClient.invalidateQueries({ queryKey: ["rotation-overrides", variables.rotationId] });
			queryClient.invalidateQueries({ queryKey: ["rotations"] });
			options?.onSuccess?.();
		},

		onError: (_err, _variables, context) => {
			if (context?.previousOverrides) {
				for (const [key, data] of context.previousOverrides) {
					queryClient.setQueryData(key, data);
				}
			}
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
		mutationFn: (data: { rotationId: string; overrideId: string }) => clearRotationOverrideFn({ data }),

		onMutate: async ({ rotationId, overrideId }) => {
			await queryClient.cancelQueries({ queryKey: ["rotations"] });
			await queryClient.cancelQueries({ queryKey: ["rotation-overrides", rotationId] });

			const previousRotations = queryClient.getQueryData<GetRotationsResponse>(["rotations"]);
			const previousOverrides = updateOverridesCache(queryClient, rotationId, ([, data]) => (data ?? []).filter((override) => override.id !== overrideId));

			queryClient.setQueryData<GetRotationsResponse>(["rotations"], (old) =>
				old?.map((rotation) => {
					if (rotation.id !== rotationId) return rotation;
					if (rotation.currentOverrideId !== overrideId) return rotation;
					return {
						...rotation,
						assignees: rotation.assignees.map((assignee) => ({
							...assignee,
							isOverride: false,
						})),
						currentOverrideId: null,
					};
				}),
			);

			return { previousRotations, previousOverrides };
		},

		onSuccess: (_result, variables) => {
			options?.onSuccess?.();
			queryClient.invalidateQueries({ queryKey: ["rotations"] });
			queryClient.invalidateQueries({ queryKey: ["rotation-overrides", variables.rotationId] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previousOverrides) {
				for (const [key, data] of context.previousOverrides) {
					queryClient.setQueryData(key, data);
				}
			}
			if (context?.previousRotations) {
				queryClient.setQueryData(["rotations"], context.previousRotations);
			}
			options?.onError?.();
		},
	}));
}

export function useUpdateRotationOverride(options?: { onSuccess?: () => void; onError?: () => void }) {
	const queryClient = useQueryClient();
	const updateRotationOverrideFn = useServerFn(updateRotationOverride);

	return useMutation(() => ({
		mutationFn: (data: { rotationId: string; overrideId: string; assigneeId: string; startAt: Date; endAt: Date }) => updateRotationOverrideFn({ data }),

		onMutate: async ({ rotationId, overrideId, assigneeId, startAt, endAt }) => {
			await queryClient.cancelQueries({ queryKey: ["rotation-overrides", rotationId] });
			await queryClient.cancelQueries({ queryKey: ["rotations"] });

			const previousRotations = queryClient.getQueryData<GetRotationsResponse>(["rotations"]);
			const previousOverrides = updateOverridesCache(queryClient, rotationId, ([key, data]) => {
				const range = getOverrideRangeFromKey(key);
				if (!range) return data ?? [];
				const intersects = startAt < range.end && endAt > range.start;
				const current = data ?? [];
				const hasOverride = current.some((override) => override.id === overrideId);
				if (!intersects) {
					return hasOverride ? current.filter((override) => override.id !== overrideId) : current;
				}
				const next = hasOverride
					? current.map((override) => (override.id === overrideId ? { ...override, assigneeId, startAt, endAt } : override))
					: [...current, { id: overrideId, assigneeId, startAt, endAt, createdAt: new Date() }];
				return sortOverrides(next);
			});

			const now = new Date();
			queryClient.setQueryData<GetRotationsResponse>(["rotations"], (old) =>
				old?.map((rotation) => {
					if (rotation.id !== rotationId) return rotation;
					if (startAt <= now && endAt > now) {
						return {
							...rotation,
							currentOverrideId: overrideId,
							assignees: rotation.assignees.map((assignee) => ({
								...assignee,
								isOverride: assignee.id === assigneeId,
							})),
						};
					}
					if (rotation.currentOverrideId === overrideId) {
						return {
							...rotation,
							currentOverrideId: null,
							assignees: rotation.assignees.map((assignee) => ({
								...assignee,
								isOverride: false,
							})),
						};
					}
					return rotation;
				}),
			);

			return { previousOverrides, previousRotations };
		},

		onSuccess: (_result, variables) => {
			options?.onSuccess?.();
			queryClient.invalidateQueries({ queryKey: ["rotation-overrides", variables.rotationId] });
			queryClient.invalidateQueries({ queryKey: ["rotations"] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previousOverrides) {
				for (const [key, data] of context.previousOverrides) {
					queryClient.setQueryData(key, data);
				}
			}
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

export function toAddSlackUserAssigneeInput(rotationId: string, user: { id: string; name?: string; avatar?: string }) {
	return {
		rotationId,
		slackUserId: user.id,
		optimisticData: { name: user.name, avatar: user.avatar },
	};
}
