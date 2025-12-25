import { createFileRoute, Outlet, redirect } from "@tanstack/solid-router";
import { Show } from "solid-js";
import Header from "~/components/Header";
import { getAuth, isAuthReady } from "~/lib/auth-store";

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
	return (
		<Show when={isAuthReady()}>
			<Header />
			<Suspense fallback={<div class="flex-1 p-6">Loading…</div>}>
				<main class="flex-1 flex flex-col">
					<Outlet />
				</main>
			</Suspense>
		</Show>
	);
}
