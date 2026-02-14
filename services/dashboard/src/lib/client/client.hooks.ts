import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { useServerFn } from "@tanstack/solid-start";
import { runDemoAware } from "../demo/runtime";
import { getClientDemo, updateClientDemo } from "../demo/store";
import { getClient, updateClient } from "./client";

type ClientResponse = Awaited<ReturnType<typeof getClient>>;

export function useClient() {
	const getClientFn = useServerFn(getClient);
	return useQuery(() => ({
		queryKey: ["client"],
		queryFn: () =>
			runDemoAware({
				demo: () => getClientDemo(),
				remote: () => getClientFn(),
			}),
		staleTime: Infinity,
	}));
}

export function useUpdateClient() {
	const queryClient = useQueryClient();
	const updateClientFn = useServerFn(updateClient);
	return useMutation(() => ({
		mutationFn: (data: { name?: string; image?: string | null }) =>
			runDemoAware({
				demo: () => updateClientDemo(data),
				remote: () => updateClientFn({ data }),
			}),
		onMutate: async (newData) => {
			await queryClient.cancelQueries({ queryKey: ["client"] });

			const previousClient = queryClient.getQueryData<ClientResponse>(["client"]);
			const patch = {
				...(newData.name !== undefined && { name: newData.name }),
				...(newData.image !== undefined && { image: newData.image }),
			};

			if (previousClient) {
				queryClient.setQueryData<ClientResponse>(["client"], { ...previousClient, ...patch });
			}

			return { previousClient };
		},
		onError: (_err, _variables, context) => {
			if (context?.previousClient) {
				queryClient.setQueryData(["client"], context.previousClient);
			}
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["client"] });
		},
	}));
}
