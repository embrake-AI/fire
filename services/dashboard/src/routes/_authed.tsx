import { createFileRoute, Outlet, redirect } from "@tanstack/solid-router";
import { Show } from "solid-js";
import Header from "~/components/Header";
import { getAuth, isAuthReady } from "~/lib/auth-store";

export const Route = createFileRoute("/_authed")({
	beforeLoad: ({ location }) => {
		// Wait for auth to be ready before making redirect decisions
		// This prevents redirecting to /login before client bootstrap finishes
		if (!isAuthReady()) {
			// Auth not ready yet - router will re-run this after invalidate()
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
		<Show when={isAuthReady()} fallback={<div class="flex-1 p-6">Loading…</div>}>
			<Header />
			<main class="flex-1 flex flex-col">
				<Outlet />
			</main>
		</Show>
	);
}
