import { useMutation, useQuery } from "@tanstack/solid-query";
import { useServerFn } from "@tanstack/solid-start";
import type { Accessor } from "solid-js";
import { runDemoAware } from "../demo/runtime";
import { startImpersonatingAction, stopImpersonatingAction } from "./impersonation";
import { getSuperAdminClients, getSuperAdminClientUsers } from "./super-admin";

function unsupportedInDemo(): never {
	throw new Error("Super admin tools are not available in demo mode.");
}

export function useSuperAdminClients() {
	const getSuperAdminClientsFn = useServerFn(getSuperAdminClients);
	return useQuery(() => ({
		queryKey: ["super-admin-clients"],
		queryFn: () =>
			runDemoAware({
				demo: async () => unsupportedInDemo(),
				remote: () => getSuperAdminClientsFn(),
			}),
		staleTime: 60_000,
	}));
}

export function useSuperAdminClientUsers(clientId: Accessor<string | null>) {
	const getSuperAdminClientUsersFn = useServerFn(getSuperAdminClientUsers);
	return useQuery(() => ({
		queryKey: ["super-admin-client-users", clientId()],
		queryFn: () =>
			runDemoAware({
				demo: async () => unsupportedInDemo(),
				remote: () => getSuperAdminClientUsersFn({ data: { clientId: clientId() ?? "" } }),
			}),
		enabled: !!clientId(),
		staleTime: 30_000,
	}));
}

export function useStartImpersonating() {
	const startImpersonatingFn = useServerFn(startImpersonatingAction);
	return useMutation(() => ({
		mutationFn: (data: { userId: string }) =>
			runDemoAware({
				demo: async () => unsupportedInDemo(),
				remote: () => startImpersonatingFn({ data }),
			}),
	}));
}

export function useStopImpersonating() {
	const stopImpersonatingFn = useServerFn(stopImpersonatingAction);
	return useMutation(() => ({
		mutationFn: () =>
			runDemoAware({
				demo: async () => unsupportedInDemo(),
				remote: () => stopImpersonatingFn(),
			}),
	}));
}
