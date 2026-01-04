import { createFileRoute, Outlet, redirect } from "@tanstack/solid-router";
import { createMemo, Show } from "solid-js";
import Sidebar from "~/components/Sidebar";
import { getAuth, isAuthReady } from "~/lib/auth/auth-store";
import { useEntryPoints } from "~/lib/entry-points/entry-points.hooks";
import { useSlackUsers } from "~/lib/useSlackUsers";

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
	// app-wide interesting data. Kept to make things feel more responsive.
	useEntryPoints();
	useSlackUsers();

	return (
		<Show when={authed()}>
			<div class="flex flex-1 min-h-0">
				<Sidebar />
				<main class="flex-1 flex flex-col overflow-y-auto">
					<Outlet />
				</main>
			</div>
		</Show>
	);
}
