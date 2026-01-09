import { createFileRoute, Outlet, redirect } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { LoaderCircle } from "lucide-solid";
import { createMemo, createSignal, Show } from "solid-js";
import { SlackIcon } from "~/components/icons/SlackIcon";
import Sidebar from "~/components/Sidebar";
import { Button } from "~/components/ui/button";
import { Dialog, DialogHeader, DialogOverlay, DialogPortal, DialogTitle } from "~/components/ui/dialog";
import { getAuth, isAuthReady } from "~/lib/auth/auth-store";
import { useEntryPoints } from "~/lib/entry-points/entry-points.hooks";
import { getInstallUrl } from "~/lib/integrations/integrations";
import { useIntegrations } from "~/lib/integrations/integrations.hooks";

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
	useEntryPoints({ enabled: authed });
	const integrationsQuery = useIntegrations({ type: "workspace", enabled: authed });

	const slackConnected = createMemo(() => {
		if (!integrationsQuery.data) return true; // Don't block while loading
		return integrationsQuery.data.some((i) => i.platform === "slack");
	});

	return (
		<Show when={authed()}>
			<div class="flex flex-1 min-h-0">
				<Sidebar />
				<main class="flex-1 flex flex-col overflow-y-auto">
					<Outlet />
				</main>
			</div>
			<Show when={!slackConnected()}>
				<SlackConnectionRequired />
			</Show>
		</Show>
	);
}

function SlackConnectionRequired() {
	const getInstallUrlFn = useServerFn(getInstallUrl);
	const [isConnecting, setIsConnecting] = createSignal(false);

	const handleConnect = async () => {
		setIsConnecting(true);
		try {
			const url = await getInstallUrlFn({ data: { platform: "slack", type: "workspace" } });
			if (url) {
				window.location.href = url;
			}
		} finally {
			setIsConnecting(false);
		}
	};

	return (
		<Dialog open modal>
			<DialogPortal>
				<DialogOverlay class="backdrop-blur-sm" />
				<div class="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 border bg-background p-6 shadow-lg rounded-lg">
					<DialogHeader class="items-center sm:text-center">
						<div class="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-muted">
							<SlackIcon class="size-8" />
						</div>
						<DialogTitle>Connect Slack to continue</DialogTitle>
						<p class="mt-2 text-sm text-muted-foreground text-center">
							Fire requires a Slack workspace connection to manage incidents. Connect your Slack workspace to get started.
						</p>
					</DialogHeader>
					<div class="mt-6 flex justify-center">
						<Button onClick={handleConnect} disabled={isConnecting()} size="lg">
							<Show when={isConnecting()}>
								<LoaderCircle class="w-4 h-4 animate-spin mr-2" />
							</Show>
							<SlackIcon class="size-4 mr-2" />
							Connect Slack
						</Button>
					</div>
				</div>
			</DialogPortal>
		</Dialog>
	);
}
