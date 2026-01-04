import { useQuery } from "@tanstack/solid-query";
import { useServerFn } from "@tanstack/solid-start";
import { createMemo } from "solid-js";
import { getSlackUsers } from "./entry-points/entry-points";
import type { getWorkspaceIntegrations } from "./integrations/integrations";

type GetWorkspaceIntegrationsResponse = Awaited<ReturnType<typeof getWorkspaceIntegrations>>;
export function useSlackUsers() {
	const integrationsQuery = useQuery<GetWorkspaceIntegrationsResponse>(() => ({
		queryKey: ["workspace_integrations"],
		staleTime: Infinity,
		enabled: false,
	}));

	const hasSlackIntegration = createMemo(() => !!integrationsQuery.data?.some((i) => i.platform === "slack" && i.installedAt));

	const getSlackUsersFn = useServerFn(getSlackUsers);
	const slackUsersQuery = useQuery(() => ({
		queryKey: ["slack-users"],
		queryFn: getSlackUsersFn,
		staleTime: Infinity,
		enabled: hasSlackIntegration(),
	}));

	return slackUsersQuery;
}
