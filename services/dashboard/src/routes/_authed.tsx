import { createFileRoute, Outlet, redirect } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { LoaderCircle } from "lucide-solid";
import { createMemo, createSignal, onMount, Show } from "solid-js";
import { SlackIcon } from "~/components/icons/SlackIcon";
import Sidebar from "~/components/Sidebar";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogOverlay, DialogPortal, DialogTitle } from "~/components/ui/dialog";
import { getAuth, isAuthReady } from "~/lib/auth/auth-store";
import { isDemoMode } from "~/lib/demo/mode";
import { runDemoAware } from "~/lib/demo/runtime";
import { connectWorkspaceIntegrationDemo } from "~/lib/demo/store";
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
	const [showDemoWelcome, setShowDemoWelcome] = createSignal(false);

	const dismissDemoWelcome = () => {
		setShowDemoWelcome(false);
	};

	onMount(() => {
		if (!isDemoMode()) return;
		setShowDemoWelcome(true);
	});
	// app-wide interesting data. Kept to make things feel more responsive.
	useEntryPoints({ enabled: authed });
	const integrationsQuery = useIntegrations({ type: "workspace", enabled: authed });

	const slackConnected = createMemo(() => {
		if (isDemoMode()) return true;
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
			<Show when={showDemoWelcome()}>
				<DemoModeWelcomeDialog onDismiss={dismissDemoWelcome} />
			</Show>
		</Show>
	);
}

function DemoModeWelcomeDialog(props: { onDismiss: () => void }) {
	const appUrl = (import.meta.env.VITE_APP_URL as string | undefined) ?? "/";

	return (
		<Dialog open onOpenChange={(open) => !open && props.onDismiss()} modal>
			<DialogContent class="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>Hey! This is demo mode.</DialogTitle>
					<DialogDescription>Browser-only experience of the Fire dashboard.</DialogDescription>
				</DialogHeader>
				<p class="text-sm text-muted-foreground">Fire is a Slack-first incident management tool, but this demo is useful to showcase its features.</p>
				<div class="mt-2 flex flex-col gap-2 sm:flex-row sm:justify-between">
					<Button as="a" href={appUrl} target="_blank" rel="noreferrer">
						Go to actual Fire dashboard
					</Button>
					<Button variant="outline" onClick={props.onDismiss}>
						Dismiss
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

function SlackConnectionRequired() {
	const getInstallUrlFn = useServerFn(getInstallUrl);
	const [isConnecting, setIsConnecting] = createSignal(false);

	const handleConnect = async () => {
		setIsConnecting(true);
		try {
			const url = await runDemoAware({
				demo: async () => {
					await connectWorkspaceIntegrationDemo("slack");
					return null;
				},
				remote: () => getInstallUrlFn({ data: { platform: "slack", type: "workspace" } }),
			});
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
