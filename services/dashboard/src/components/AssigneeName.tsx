import { useQuery } from "@tanstack/solid-query";
import { useServerFn } from "@tanstack/solid-start";
import type { Accessor } from "solid-js";
import { createMemo } from "solid-js";
import { getSlackUserGroups, getSlackUsers } from "~/lib/entry-points";
import { getIntegrations } from "~/lib/integrations";

function useSlackIntegration(props: { enabled: Accessor<boolean>; id: Accessor<string | null | undefined> }) {
	const getSlackUsersFn = useServerFn(getSlackUsers);
	const getSlackUserGroupsFn = useServerFn(getSlackUserGroups);

	const slackUsersQuery = useQuery(() => ({
		queryKey: ["slack-users"],
		queryFn: getSlackUsersFn,
		staleTime: Infinity,
		enabled: props.enabled(),
		refetchOnMount: false,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	}));

	const slackGroupsQuery = useQuery(() => ({
		queryKey: ["slack-groups"],
		queryFn: getSlackUserGroupsFn,
		staleTime: Infinity,
		enabled: props.enabled(),
		refetchOnMount: false,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	}));

	const name = createMemo(() => {
		const id = props.id?.();
		if (!id) return null;
		const user = slackUsersQuery.data?.find((u) => u.id === id);
		if (user) return user.name;
		const group = slackGroupsQuery.data?.find((g) => g.id === id);
		if (group) return group.name;
		return id;
	});
	return name;
}

export function AssigneeName(props: { id: Accessor<string | null | undefined> }) {
	const getIntegrationsFn = useServerFn(getIntegrations);

	const integrationsQuery = useQuery(() => ({
		queryKey: ["integrations"],
		queryFn: getIntegrationsFn,
		staleTime: Infinity,
		refetchOnMount: false,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	}));

	const isSlackConnected = createMemo(() => !!integrationsQuery.data?.some((i) => i.platform === "slack"));

	const nameFromSlack = useSlackIntegration({ enabled: isSlackConnected, id: props.id });

	const name = createMemo(() => {
		const slackName = nameFromSlack();
		if (slackName) return slackName;
		return props.id ?? "Unassigned";
	});

	return <>{name()}</>;
}
