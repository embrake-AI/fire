import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { useServerFn } from "@tanstack/solid-start";
import type { Accessor } from "solid-js";
import { runDemoAware } from "../demo/runtime";
import {
	createStatusPageDemo,
	deleteStatusPageDemo,
	getStatusPagesDemo,
	updateStatusPageDemo,
	updateStatusPageServiceDescriptionDemo,
	updateStatusPageServicesDemo,
	verifyCustomDomainDemo,
} from "../demo/store";
import type { getServices } from "../services/services";
import {
	createStatusPage,
	deleteStatusPage,
	getStatusPages,
	updateStatusPage,
	updateStatusPageServiceDescription,
	updateStatusPageServices,
	verifyCustomDomain,
} from "./status-pages";

type GetStatusPagesResponse = Awaited<ReturnType<typeof getStatusPages>>;
type GetServicesResponse = Awaited<ReturnType<typeof getServices>>;

function toTempSlug(value: string) {
	return value
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

export function useStatusPages(options?: { enabled?: Accessor<boolean> }) {
	const getStatusPagesFn = useServerFn(getStatusPages);
	return useQuery(() => ({
		queryKey: ["status-pages"],
		queryFn: () =>
			runDemoAware({
				demo: () => getStatusPagesDemo(),
				remote: () => getStatusPagesFn(),
			}),
		staleTime: 60_000,
		enabled: options?.enabled?.() ?? true,
	}));
}

export function useCreateStatusPage(options?: { onMutate?: (tempId: string) => void; onSuccess?: (realId: string) => void; onError?: () => void }) {
	const queryClient = useQueryClient();
	const createStatusPageFn = useServerFn(createStatusPage);

	return useMutation(() => ({
		mutationFn: (data: { name: string; slug: string }) =>
			runDemoAware({
				demo: () => createStatusPageDemo(data),
				remote: () => createStatusPageFn({ data }),
			}),

		onMutate: async (newData) => {
			await queryClient.cancelQueries({ queryKey: ["status-pages"] });
			const previousStatusPages = queryClient.getQueryData<GetStatusPagesResponse>(["status-pages"]);
			const tempId = `temp-${Date.now()}`;

			const name = newData.name.trim();
			const slug = toTempSlug(newData.slug.trim());

			const optimisticPage: GetStatusPagesResponse[number] = {
				id: tempId,
				name,
				slug,
				logoUrl: null,
				faviconUrl: null,
				serviceDisplayMode: "bars_percentage",
				customDomain: null,
				supportUrl: null,
				privacyPolicyUrl: null,
				termsOfServiceUrl: null,
				createdAt: new Date(),
				updatedAt: new Date(),
				services: [],
				serviceCount: 0,
			};

			queryClient.setQueryData<GetStatusPagesResponse>(["status-pages"], (old) => [optimisticPage, ...(old ?? [])]);

			options?.onMutate?.(tempId);

			return { previousStatusPages, tempId };
		},

		onSuccess: (page, _variables, context) => {
			if (page?.id && context?.tempId) {
				queryClient.setQueryData<GetStatusPagesResponse>(["status-pages"], (old) => old?.map((p) => (p.id === context.tempId ? { ...p, ...page, id: page.id } : p)));
				options?.onSuccess?.(page.id);
			}

			queryClient.invalidateQueries({ queryKey: ["status-pages"] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previousStatusPages) {
				queryClient.setQueryData(["status-pages"], context.previousStatusPages);
			}
			options?.onError?.();
		},
	}));
}

export function useUpdateStatusPage(options?: { onSuccess?: () => void; onError?: () => void }) {
	const queryClient = useQueryClient();
	const updateStatusPageFn = useServerFn(updateStatusPage);

	return useMutation(() => ({
		mutationFn: (data: {
			id: string;
			name?: string;
			slug?: string;
			logoUrl?: string | null;
			faviconUrl?: string | null;
			serviceDisplayMode?: string | null;
			customDomain?: string | null;
			supportUrl?: string | null;
			privacyPolicyUrl?: string | null;
			termsOfServiceUrl?: string | null;
		}) =>
			runDemoAware({
				demo: () => updateStatusPageDemo(data),
				remote: () => updateStatusPageFn({ data }),
			}),

		onMutate: async (data) => {
			await queryClient.cancelQueries({ queryKey: ["status-pages"] });

			const previousStatusPages = queryClient.getQueryData<GetStatusPagesResponse>(["status-pages"]);

			if (previousStatusPages) {
				queryClient.setQueryData<GetStatusPagesResponse>(["status-pages"], (old) =>
					old?.map((page) => {
						if (page.id !== data.id) return page;
						return {
							...page,
							...(data.name !== undefined ? { name: data.name } : {}),
							...(data.slug !== undefined ? { slug: data.slug } : {}),
							...(data.logoUrl !== undefined ? { logoUrl: data.logoUrl } : {}),
							...(data.faviconUrl !== undefined ? { faviconUrl: data.faviconUrl } : {}),
							...(data.serviceDisplayMode !== undefined ? { serviceDisplayMode: data.serviceDisplayMode } : {}),
							...(data.customDomain !== undefined ? { customDomain: data.customDomain } : {}),
							...(data.supportUrl !== undefined ? { supportUrl: data.supportUrl } : {}),
							...(data.privacyPolicyUrl !== undefined ? { privacyPolicyUrl: data.privacyPolicyUrl } : {}),
							...(data.termsOfServiceUrl !== undefined ? { termsOfServiceUrl: data.termsOfServiceUrl } : {}),
						};
					}),
				);
			}

			return { previousStatusPages };
		},

		onSuccess: (_result, _variables) => {
			options?.onSuccess?.();
			queryClient.invalidateQueries({ queryKey: ["status-pages"] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previousStatusPages) {
				queryClient.setQueryData(["status-pages"], context.previousStatusPages);
			}
			options?.onError?.();
		},
	}));
}

export function useDeleteStatusPage(options?: { onSuccess?: () => void; onError?: () => void }) {
	const queryClient = useQueryClient();
	const deleteStatusPageFn = useServerFn(deleteStatusPage);

	return useMutation(() => ({
		mutationFn: (id: string) =>
			runDemoAware({
				demo: () => deleteStatusPageDemo({ id }),
				remote: () => deleteStatusPageFn({ data: { id } }),
			}),

		onMutate: async (id) => {
			await queryClient.cancelQueries({ queryKey: ["status-pages"] });
			const previousStatusPages = queryClient.getQueryData<GetStatusPagesResponse>(["status-pages"]);

			queryClient.setQueryData<GetStatusPagesResponse>(["status-pages"], (old) => old?.filter((page) => page.id !== id));

			return { previousStatusPages };
		},

		onSuccess: () => {
			options?.onSuccess?.();
			queryClient.invalidateQueries({ queryKey: ["status-pages"] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previousStatusPages) {
				queryClient.setQueryData(["status-pages"], context.previousStatusPages);
			}
			options?.onError?.();
		},
	}));
}

export function useUpdateStatusPageServices(options?: { onSuccess?: () => void; onError?: () => void }) {
	const queryClient = useQueryClient();
	const updateStatusPageServicesFn = useServerFn(updateStatusPageServices);

	return useMutation(() => ({
		mutationFn: (data: { id: string; serviceIds: string[] }) =>
			runDemoAware({
				demo: () => updateStatusPageServicesDemo(data),
				remote: () => updateStatusPageServicesFn({ data }),
			}),

		onMutate: async (data) => {
			await queryClient.cancelQueries({ queryKey: ["status-pages"] });

			const previousStatusPages = queryClient.getQueryData<GetStatusPagesResponse>(["status-pages"]);
			const servicesCache = queryClient.getQueryData<GetServicesResponse>(["services"]);

			if (previousStatusPages) {
				type StatusPageServiceBase = Omit<GetStatusPagesResponse[number]["services"][number], "position">;

				queryClient.setQueryData<GetStatusPagesResponse>(["status-pages"], (old) =>
					old?.map((page) => {
						if (page.id !== data.id) return page;

						const serviceLookup = new Map<string, StatusPageServiceBase>();
						for (const service of page.services) {
							const { position: _position, ...base } = service;
							serviceLookup.set(service.id, base);
						}
						if (servicesCache) {
							for (const service of servicesCache) {
								if (!serviceLookup.has(service.id)) {
									serviceLookup.set(service.id, {
										id: service.id,
										name: service.name,
										description: null,
										imageUrl: service.imageUrl,
										createdAt: service.createdAt,
									});
								}
							}
						}

						const nextServices: GetStatusPagesResponse[number]["services"] = [];
						for (const [index, serviceId] of data.serviceIds.entries()) {
							const service = serviceLookup.get(serviceId);
							if (!service) continue;
							nextServices.push({
								...service,
								position: index,
							});
						}

						return {
							...page,
							services: nextServices,
							serviceCount: nextServices.length,
						};
					}),
				);
			}

			return { previousStatusPages };
		},

		onSuccess: (_result, _variables) => {
			options?.onSuccess?.();
			queryClient.invalidateQueries({ queryKey: ["status-pages"] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previousStatusPages) {
				queryClient.setQueryData(["status-pages"], context.previousStatusPages);
			}
			options?.onError?.();
		},
	}));
}

export function useUpdateStatusPageServiceDescription(options?: { onSuccess?: () => void; onError?: () => void }) {
	const queryClient = useQueryClient();
	const updateStatusPageServiceDescriptionFn = useServerFn(updateStatusPageServiceDescription);

	return useMutation(() => ({
		mutationFn: (data: { statusPageId: string; serviceId: string; description: string | null }) =>
			runDemoAware({
				demo: () => updateStatusPageServiceDescriptionDemo(data),
				remote: () => updateStatusPageServiceDescriptionFn({ data }),
			}),

		onMutate: async (data) => {
			await queryClient.cancelQueries({ queryKey: ["status-pages"] });

			const previousStatusPages = queryClient.getQueryData<GetStatusPagesResponse>(["status-pages"]);

			if (previousStatusPages) {
				queryClient.setQueryData<GetStatusPagesResponse>(["status-pages"], (old) =>
					old?.map((page) => {
						if (page.id !== data.statusPageId) return page;
						return {
							...page,
							services: page.services.map((service) => {
								if (service.id !== data.serviceId) return service;
								return {
									...service,
									description: data.description?.trim() || null,
								};
							}),
						};
					}),
				);
			}

			return { previousStatusPages };
		},

		onSuccess: () => {
			options?.onSuccess?.();
			queryClient.invalidateQueries({ queryKey: ["status-pages"] });
		},

		onError: (_err, _variables, context) => {
			if (context?.previousStatusPages) {
				queryClient.setQueryData(["status-pages"], context.previousStatusPages);
			}
			options?.onError?.();
		},
	}));
}

export function useVerifyCustomDomain() {
	const verifyCustomDomainFn = useServerFn(verifyCustomDomain);

	return useMutation(() => ({
		mutationFn: (id: string) =>
			runDemoAware({
				demo: () => verifyCustomDomainDemo({ id }),
				remote: () => verifyCustomDomainFn({ data: { id } }),
			}),
	}));
}
