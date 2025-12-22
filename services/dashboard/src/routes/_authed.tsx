import { createFileRoute, Outlet, redirect } from "@tanstack/solid-router";
import Header from "~/components/Header";

export const Route = createFileRoute("/_authed")({
	beforeLoad: ({ context, location }) => {
		if (!context.userId || !context.clientId) {
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
		<>
			<Header />
			<main class="flex-1 flex flex-col">
				<Outlet />
			</main>
		</>
	);
}
