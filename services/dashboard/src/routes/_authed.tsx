import { createFileRoute, Outlet, redirect } from "@tanstack/solid-router";
import { LoaderCircle } from "lucide-solid";
import { createMemo, createSignal, onMount, Show } from "solid-js";
import { SlackIcon } from "~/components/icons/SlackIcon";
import Sidebar from "~/components/Sidebar";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogOverlay, DialogPortal, DialogTitle } from "~/components/ui/dialog";
import { showToast } from "~/components/ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { getAuth, isAuthReady } from "~/lib/auth/auth-store";
import { useStopImpersonating } from "~/lib/auth/super-admin.hooks";
import { isDemoMode } from "~/lib/demo/mode";
import { runDemoAware } from "~/lib/demo/runtime";
import { connectWorkspaceIntegrationDemo } from "~/lib/demo/store";
import { useEntryPoints } from "~/lib/entry-points/entry-points.hooks";
import { useInstallUrl, useIntegrations } from "~/lib/integrations/integrations.hooks";

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
	const role = createMemo(() => {
		if (isDemoMode()) {
			return "ADMIN" as const;
		}
		return getAuth()?.role;
	});
	const shouldLoadShellData = createMemo(() => authed() && role() !== "VIEWER");
	const isImpersonating = createMemo(() => !!getAuth()?.impersonatedBy);
	const [showDemoWelcome, setShowDemoWelcome] = createSignal(false);

	const dismissDemoWelcome = () => {
		setShowDemoWelcome(false);
	};

	onMount(() => {
		if (!isDemoMode()) return;
		setShowDemoWelcome(true);
	});
	// app-wide interesting data. Kept to make things feel more responsive.
	useEntryPoints({ enabled: shouldLoadShellData });
	const integrationsQuery = useIntegrations({ type: "workspace", enabled: shouldLoadShellData });

	const slackConnected = createMemo(() => {
		if (role() === "VIEWER") return true;
		if (isDemoMode()) return true;
		if (!integrationsQuery.isSuccess) return true; // Don't block while loading
		return integrationsQuery.data.some((i) => i.platform === "slack");
	});

	return (
		<Show when={authed()}>
			<Show
				when={role() !== "VIEWER"}
				fallback={
					<main class="flex-1 flex flex-col overflow-y-auto">
						<Show when={isImpersonating()}>
							<ImpersonationBanner />
						</Show>
						<ViewerRoleBadge />
						<Outlet />
					</main>
				}
			>
				<div class="flex flex-1 min-h-0">
					<Sidebar />
					<main class="flex-1 flex flex-col overflow-y-auto">
						<Show when={isImpersonating()}>
							<ImpersonationBanner />
						</Show>
						<Outlet />
					</main>
				</div>
				<Show when={!slackConnected()}>
					<SlackConnectionRequired />
				</Show>
			</Show>
			<Show when={showDemoWelcome()}>
				<DemoModeWelcomeDialog onDismiss={dismissDemoWelcome} />
			</Show>
		</Show>
	);
}

function ViewerRoleBadge() {
	return (
		<div class="px-6 pt-4 flex justify-end">
			<Tooltip>
				<TooltipTrigger as="span" class="inline-flex">
					<Badge variant="secondary" class="cursor-help">
						Viewer
					</Badge>
				</TooltipTrigger>
				<TooltipContent class="max-w-xs text-xs leading-relaxed">
					You currently have Viewer access, which is read-only. Ask a workspace admin for a Member role to unlock more of the platform.
				</TooltipContent>
			</Tooltip>
		</div>
	);
}

function ImpersonationBanner() {
	const stopImpersonatingMutation = useStopImpersonating();
	const auth = createMemo(() => getAuth());

	const userLabel = createMemo(() => {
		return auth()?.userId ?? "unknown-user";
	});

	const clientLabel = createMemo(() => {
		return auth()?.clientId ?? "unknown-client";
	});

	const handleStopImpersonation = async () => {
		try {
			await stopImpersonatingMutation.mutateAsync();
			window.location.assign("/");
		} catch {
			showToast({
				title: "Unable to stop impersonation",
				description: "Please try again.",
				variant: "error",
			});
		}
	};

	return (
		<div class="border-b border-amber-300 bg-amber-50 px-4 py-2">
			<div class="mx-auto flex max-w-6xl items-center justify-between gap-3">
				<div class="min-w-0">
					<p class="text-sm font-medium text-amber-900">Impersonation active</p>
					<p class="text-xs text-amber-800 truncate">
						User: {userLabel()} | Client: {clientLabel()}
					</p>
				</div>
				<Button size="sm" variant="outline" onClick={() => void handleStopImpersonation()} disabled={stopImpersonatingMutation.isPending}>
					<Show when={stopImpersonatingMutation.isPending}>
						<LoaderCircle class="w-4 h-4 animate-spin mr-2" />
					</Show>
					Stop impersonation
				</Button>
			</div>
		</div>
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
	const getInstallUrlFn = useInstallUrl();
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
