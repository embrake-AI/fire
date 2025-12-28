import { useQuery } from "@tanstack/solid-query";
import { createFileRoute, Outlet, redirect } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { createMemo, Show } from "solid-js";
import Header from "~/components/Header";
import { getAuth, isAuthReady } from "~/lib/auth-store";
import { getEntryPoints, getSlackUsers } from "~/lib/entry-points";
import { getWorkspaceIntegrations } from "~/lib/integrations";

export const Route = createFileRoute("/_authed")({
	beforeLoad: ({ location }) => {
		if (!isAuthReady()) {
			return;
		}

		const auth = getAuth();
		if (!auth?.userId || !auth?.clientId) {
			throw redirect({
				to: "/login",
				search: { redirect: location.href },
			});
		}
	},
	component: AuthedLayout,
});

function AuthedLayout() {
	const authed = createMemo(() => {
		const auth = getAuth();
		return !!auth?.userId && !!auth?.clientId;
	});
	const getEntryPointsFn = useServerFn(getEntryPoints);
	const getWorkspaceIntegrationsFn = useServerFn(getWorkspaceIntegrations);
	const getSlackUsersFn = useServerFn(getSlackUsers);

	// app-wide interesting data. Kept to make things feel more responsive.
	useQuery(() => ({
		queryKey: ["entry-points"],
		queryFn: getEntryPointsFn,
		staleTime: 60_000,
		enabled: authed(),
	}));
	const integrationsQuery = useQuery(() => ({
		queryKey: ["integrations"],
		queryFn: getWorkspaceIntegrationsFn,
		staleTime: 60_000,
		enabled: authed(),
	}));

	const hasSlackIntegration = createMemo(() => integrationsQuery.data?.some((i) => i.platform === "slack" && i.installedAt));

	useQuery(() => ({
		queryKey: ["slack-users"],
		queryFn: getSlackUsersFn,
		staleTime: Infinity,
		enabled: authed() && hasSlackIntegration(),
	}));

	return (
		<Show when={authed()}>
			<Header />
			<main class="flex-1 flex flex-col overflow-y-auto">
				<Outlet />
			</main>
		</Show>
	);
}
