import { useQuery } from "@tanstack/solid-query";
import { useServerFn } from "@tanstack/solid-start";
import type { Accessor } from "solid-js";
import { getUserIntegrations, getWorkspaceIntegrations } from "./integrations";

export function useIntegrations(options?: { type?: "workspace" | "user"; enabled?: Accessor<boolean> }) {
	const getWorkspaceIntegrationsFn = useServerFn(getWorkspaceIntegrations);
	const getUserIntegrationsFn = useServerFn(getUserIntegrations);
	const type = options ? (options.type ?? "workspace") : "workspace";

	return useQuery(() => ({
		queryKey: type === "workspace" ? ["workspace_integrations"] : ["user_integrations"],
		queryFn: () => (type === "workspace" ? getWorkspaceIntegrationsFn() : getUserIntegrationsFn()),
		staleTime: 60_000,
		enabled: options?.enabled?.() ?? true,
	}));
}
