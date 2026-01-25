import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { useServerFn } from "@tanstack/solid-start";
import type { Accessor } from "solid-js";
import {
	addServiceDependency,
	addServiceTeamOwner,
	addServiceUserOwner,
	createService,
	deleteService,
	getServices,
	removeServiceDependency,
	removeServiceTeamOwner,
	removeServiceUserOwner,
	updateService,
} from "./services";

type GetServicesResponse = Awaited<ReturnType<typeof getServices>>;

export function useServices(options?: { enabled?: Accessor<boolean> }) {
	const getServicesFn = useServerFn(getServices);
	return useQuery(() => ({
		queryKey: ["services"],
		queryFn: () => getServicesFn(),
		staleTime: 60_000,
		enabled: options?.enabled?.() ?? true,
	}));
}

export function useCreateService(options?: { onMutate?: (tempId: string) => void; onSuccess?: (realId: string) => void; onError?: () => void }) {
	const queryClient = useQueryClient();
	const createServiceFn = useServerFn(createService);

	return useMutation(() => ({
		mutationFn: (data: { name?: string; description?: string | null; prompt?: string | null; teamOwnerIds?: string[] }) => createServiceFn({ data }),

		onMutate: async (newData) => {
			await queryClient.cancelQueries({ queryKey: ["services"] });

			const previousServices = queryClient.getQueryData<GetServicesResponse>(["services"]);
			const tempId = `temp-${Date.now()}`;
			const teamOwnerIds = newData.teamOwnerIds ?? [];

			const optimisticService: GetServicesResponse[number] = {
				id: tempId,
				name: newData.name?.trim() ?? "",
				description: newData.description?.trim() ? newData.description.trim() : null,
				prompt: newData.prompt?.trim() ? newData.prompt.trim() : null,
				imageUrl: null,
				createdAt: new Date(),
				updatedAt: new Date(),
				teamOwnerIds,
				userOwnerIds: [],
				affectsServiceIds: [],
				affectedByServiceIds: [],
			};

			queryClient.setQueryData<GetServicesResponse>(["services"], (old) => [optimisticService, ...(old ?? [])]);

			options?.onMutate?.(tempId);

			return { previousServices, tempId };
		},

		onSuccess: (service, _variables, context) => {
			if (service?.id && context?.tempId) {
				queryClient.setQueryData<GetServicesResponse>(["services"], (old) => old?.map((s) => (s.id === context.tempId ? { ...s, ...service, id: service.id } : s)));
				options?.onSuccess?.(service.id);
			}

			queryClient.invalidateQueries({ queryKey: ["services"] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previousServices) {
				queryClient.setQueryData(["services"], context.previousServices);
			}
			options?.onError?.();
		},
	}));
}

export function useUpdateService(options?: { onSuccess?: () => void; onError?: () => void }) {
	const queryClient = useQueryClient();
	const updateServiceFn = useServerFn(updateService);

	return useMutation(() => ({
		mutationFn: (data: { id: string; name?: string; description?: string | null; prompt?: string | null; imageUrl?: string | null }) => updateServiceFn({ data }),

		onMutate: async (data) => {
			await queryClient.cancelQueries({ queryKey: ["services"] });

			const previousServices = queryClient.getQueryData<GetServicesResponse>(["services"]);

			queryClient.setQueryData<GetServicesResponse>(["services"], (old) =>
				old?.map((service) => {
					if (service.id !== data.id) return service;
					return {
						...service,
						...(data.name !== undefined ? { name: data.name } : {}),
						...(data.description !== undefined ? { description: data.description } : {}),
						...(data.prompt !== undefined ? { prompt: data.prompt } : {}),
						...(data.imageUrl !== undefined ? { imageUrl: data.imageUrl } : {}),
					};
				}),
			);

			return { previousServices };
		},

		onSuccess: () => {
			options?.onSuccess?.();
			queryClient.invalidateQueries({ queryKey: ["services"] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previousServices) {
				queryClient.setQueryData(["services"], context.previousServices);
			}
			options?.onError?.();
		},
	}));
}

export function useDeleteService(options?: { onSuccess?: () => void; onError?: () => void }) {
	const queryClient = useQueryClient();
	const deleteServiceFn = useServerFn(deleteService);

	return useMutation(() => ({
		mutationFn: (id: string) => deleteServiceFn({ data: { id } }),

		onMutate: async (id) => {
			await queryClient.cancelQueries({ queryKey: ["services"] });

			const previousServices = queryClient.getQueryData<GetServicesResponse>(["services"]);

			queryClient.setQueryData<GetServicesResponse>(["services"], (old) => old?.filter((service) => service.id !== id));

			return { previousServices };
		},

		onSuccess: () => {
			options?.onSuccess?.();
			queryClient.invalidateQueries({ queryKey: ["services"] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previousServices) {
				queryClient.setQueryData(["services"], context.previousServices);
			}
			options?.onError?.();
		},
	}));
}

export function useAddServiceTeamOwner(options?: { onSuccess?: () => void; onError?: () => void }) {
	const queryClient = useQueryClient();
	const addTeamOwnerFn = useServerFn(addServiceTeamOwner);

	return useMutation(() => ({
		mutationFn: (data: { serviceId: string; teamId: string }) => addTeamOwnerFn({ data }),

		onMutate: async ({ serviceId, teamId }) => {
			await queryClient.cancelQueries({ queryKey: ["services"] });
			const previousServices = queryClient.getQueryData<GetServicesResponse>(["services"]);

			queryClient.setQueryData<GetServicesResponse>(["services"], (old) =>
				old?.map((service) => (service.id === serviceId && !service.teamOwnerIds.includes(teamId) ? { ...service, teamOwnerIds: [...service.teamOwnerIds, teamId] } : service)),
			);

			return { previousServices };
		},

		onSuccess: () => {
			options?.onSuccess?.();
			queryClient.invalidateQueries({ queryKey: ["services"] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previousServices) {
				queryClient.setQueryData(["services"], context.previousServices);
			}
			options?.onError?.();
		},
	}));
}

export function useRemoveServiceTeamOwner(options?: { onSuccess?: () => void; onError?: () => void }) {
	const queryClient = useQueryClient();
	const removeTeamOwnerFn = useServerFn(removeServiceTeamOwner);

	return useMutation(() => ({
		mutationFn: (data: { serviceId: string; teamId: string }) => removeTeamOwnerFn({ data }),

		onMutate: async ({ serviceId, teamId }) => {
			await queryClient.cancelQueries({ queryKey: ["services"] });
			const previousServices = queryClient.getQueryData<GetServicesResponse>(["services"]);

			queryClient.setQueryData<GetServicesResponse>(["services"], (old) =>
				old?.map((service) => (service.id === serviceId ? { ...service, teamOwnerIds: service.teamOwnerIds.filter((id: string) => id !== teamId) } : service)),
			);

			return { previousServices };
		},

		onSuccess: () => {
			options?.onSuccess?.();
			queryClient.invalidateQueries({ queryKey: ["services"] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previousServices) {
				queryClient.setQueryData(["services"], context.previousServices);
			}
			options?.onError?.();
		},
	}));
}

export function useAddServiceUserOwner(options?: { onSuccess?: () => void; onError?: () => void }) {
	const queryClient = useQueryClient();
	const addUserOwnerFn = useServerFn(addServiceUserOwner);

	return useMutation(() => ({
		mutationFn: (data: { serviceId: string; userId: string }) => addUserOwnerFn({ data }),

		onMutate: async ({ serviceId, userId }) => {
			await queryClient.cancelQueries({ queryKey: ["services"] });
			const previousServices = queryClient.getQueryData<GetServicesResponse>(["services"]);

			queryClient.setQueryData<GetServicesResponse>(["services"], (old) =>
				old?.map((service) => (service.id === serviceId && !service.userOwnerIds.includes(userId) ? { ...service, userOwnerIds: [...service.userOwnerIds, userId] } : service)),
			);

			return { previousServices };
		},

		onSuccess: () => {
			options?.onSuccess?.();
			queryClient.invalidateQueries({ queryKey: ["services"] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previousServices) {
				queryClient.setQueryData(["services"], context.previousServices);
			}
			options?.onError?.();
		},
	}));
}

export function useRemoveServiceUserOwner(options?: { onSuccess?: () => void; onError?: () => void }) {
	const queryClient = useQueryClient();
	const removeUserOwnerFn = useServerFn(removeServiceUserOwner);

	return useMutation(() => ({
		mutationFn: (data: { serviceId: string; userId: string }) => removeUserOwnerFn({ data }),

		onMutate: async ({ serviceId, userId }) => {
			await queryClient.cancelQueries({ queryKey: ["services"] });
			const previousServices = queryClient.getQueryData<GetServicesResponse>(["services"]);

			queryClient.setQueryData<GetServicesResponse>(["services"], (old) =>
				old?.map((service) => (service.id === serviceId ? { ...service, userOwnerIds: service.userOwnerIds.filter((id: string) => id !== userId) } : service)),
			);

			return { previousServices };
		},

		onSuccess: () => {
			options?.onSuccess?.();
			queryClient.invalidateQueries({ queryKey: ["services"] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previousServices) {
				queryClient.setQueryData(["services"], context.previousServices);
			}
			options?.onError?.();
		},
	}));
}

export function useAddServiceDependency(options?: { onSuccess?: () => void; onError?: () => void }) {
	const queryClient = useQueryClient();
	const addDependencyFn = useServerFn(addServiceDependency);

	return useMutation(() => ({
		mutationFn: (data: { baseServiceId: string; affectedServiceId: string }) => addDependencyFn({ data }),

		onMutate: async ({ baseServiceId, affectedServiceId }) => {
			await queryClient.cancelQueries({ queryKey: ["services"] });
			const previousServices = queryClient.getQueryData<GetServicesResponse>(["services"]);

			queryClient.setQueryData<GetServicesResponse>(["services"], (old) =>
				old?.map((service) => {
					if (service.id === baseServiceId && !service.affectsServiceIds.includes(affectedServiceId)) {
						return { ...service, affectsServiceIds: [...service.affectsServiceIds, affectedServiceId] };
					}
					if (service.id === affectedServiceId && !service.affectedByServiceIds.includes(baseServiceId)) {
						return { ...service, affectedByServiceIds: [...service.affectedByServiceIds, baseServiceId] };
					}
					return service;
				}),
			);

			return { previousServices };
		},

		onSuccess: () => {
			options?.onSuccess?.();
			queryClient.invalidateQueries({ queryKey: ["services"] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previousServices) {
				queryClient.setQueryData(["services"], context.previousServices);
			}
			options?.onError?.();
		},
	}));
}

export function useRemoveServiceDependency(options?: { onSuccess?: () => void; onError?: () => void }) {
	const queryClient = useQueryClient();
	const removeDependencyFn = useServerFn(removeServiceDependency);

	return useMutation(() => ({
		mutationFn: (data: { baseServiceId: string; affectedServiceId: string }) => removeDependencyFn({ data }),

		onMutate: async ({ baseServiceId, affectedServiceId }) => {
			await queryClient.cancelQueries({ queryKey: ["services"] });
			const previousServices = queryClient.getQueryData<GetServicesResponse>(["services"]);

			queryClient.setQueryData<GetServicesResponse>(["services"], (old) =>
				old?.map((service) => {
					if (service.id === baseServiceId) {
						return { ...service, affectsServiceIds: service.affectsServiceIds.filter((id) => id !== affectedServiceId) };
					}
					if (service.id === affectedServiceId) {
						return { ...service, affectedByServiceIds: service.affectedByServiceIds.filter((id) => id !== baseServiceId) };
					}
					return service;
				}),
			);

			return { previousServices };
		},

		onSuccess: () => {
			options?.onSuccess?.();
			queryClient.invalidateQueries({ queryKey: ["services"] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previousServices) {
				queryClient.setQueryData(["services"], context.previousServices);
			}
			options?.onError?.();
		},
	}));
}
