import { useQuery } from "@tanstack/solid-query";
import { useServerFn } from "@tanstack/solid-start";
import { createMemo } from "solid-js";
import { getSlackUsers } from "./entry-points";
import type { getIntegrations } from "./integrations";

type GetIntegrationsResponse = Awaited<ReturnType<typeof getIntegrations>>;
export function useSlackUsers() {
	const integrationsQuery = useQuery<GetIntegrationsResponse>(() => ({
		queryKey: ["integrations"],
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
