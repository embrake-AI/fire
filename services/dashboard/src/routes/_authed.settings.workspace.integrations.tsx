import { useMutation, useQueryClient } from "@tanstack/solid-query";
import { createFileRoute } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { LoaderCircle } from "lucide-solid";
import { createSignal, onMount, Show, Suspense } from "solid-js";
import { SlackIcon } from "~/components/icons/SlackIcon";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { showToast } from "~/components/ui/toast";
import { disconnectWorkspaceIntegration, getInstallUrl } from "~/lib/integrations/integrations";
import { useIntegrations } from "~/lib/integrations/integrations.hooks";

export const Route = createFileRoute("/_authed/settings/workspace/integrations")({
	component: WorkspaceIntegrationsPage,
	validateSearch: (search) => {
		if ("installed" in search) {
			return { installed: search.installed };
		}
		return {};
	},
});

function WorkspaceIntegrationsPage() {
	return (
		<div class="space-y-8">
			<div>
				<h2 class="text-lg font-semibold text-foreground">Workspace Integrations</h2>
				<p class="text-sm text-muted-foreground mt-1">Connect third-party services to your workspace</p>
			</div>

			<Suspense fallback={<IntegrationsSkeleton />}>
				<IntegrationsContent />
			</Suspense>
		</div>
	);
}

function IntegrationsSkeleton() {
	return (
		<div class="rounded-xl bg-muted/20 px-4 py-2">
			<div class="divide-y divide-border/40">
				<div class="flex items-center justify-between py-3">
					<div class="flex items-center gap-3">
						<Skeleton class="size-10 rounded" />
						<Skeleton class="h-4 w-24" />
					</div>
					<Skeleton class="h-9 w-24 rounded-md" />
				</div>
			</div>
		</div>
	);
}

function IntegrationsContent() {
	const params = Route.useSearch();
	const navigate = Route.useNavigate();
	const queryClient = useQueryClient();
	const integrationsQuery = useIntegrations({ type: "workspace" });
	const getInstallUrlFn = useServerFn(getInstallUrl);
	const [isConnecting, setIsConnecting] = createSignal(false);

	onMount(() => {
		const search = params();
		const installed = "installed" in search ? (search.installed as string) : null;
		if (installed) {
			queryClient.invalidateQueries({ queryKey: ["users"] });
			showToast({
				title: "Integration connected",
				description: `${installed} has been successfully connected to your workspace.`,
				variant: "success",
			});
			navigate({ to: ".", search: {}, replace: true });
		}
	});

	const handleConnect = async (platform: "slack") => {
		setIsConnecting(true);
		try {
			const url = await getInstallUrlFn({ data: { platform, type: "workspace" } });
			if (url) {
				window.location.href = url;
			}
		} finally {
			setIsConnecting(false);
		}
	};

	const disconnectFn = useServerFn(disconnectWorkspaceIntegration);
	const disconnectMutation = useMutation(() => ({
		mutationFn: (platform: "slack") => disconnectFn({ data: platform }),
		onSuccess: async (_, platform) => {
			await queryClient.invalidateQueries({ queryKey: ["workspace_integrations"] });
			await queryClient.invalidateQueries({ queryKey: ["users"] });
			showToast({
				title: "Integration disconnected",
				description: `${platform} has been successfully disconnected from your workspace.`,
				variant: "success",
			});
		},
	}));

	const isConnected = (platform: "slack") => {
		return integrationsQuery.data?.some((i) => i.platform === platform) ?? false;
	};

	return (
		<div class="rounded-xl bg-muted/20 px-4 py-2">
			<div class="divide-y divide-border/40">
				<div class="flex items-center justify-between py-3">
					<div class="flex items-center gap-3">
						<div class="flex items-center justify-center size-10 rounded-lg bg-muted">
							<SlackIcon class="size-5" />
						</div>
						<span class="text-sm font-medium text-foreground">Slack</span>
						<Show when={isConnected("slack")}>
							<Badge class="bg-emerald-100 text-emerald-700 border-emerald-200">Connected</Badge>
						</Show>
					</div>
					<Show
						when={isConnected("slack")}
						fallback={
							<Button onClick={() => handleConnect("slack")} disabled={isConnecting()}>
								<Show when={isConnecting()}>
									<LoaderCircle class="w-4 h-4 animate-spin mr-2" />
								</Show>
								Connect
							</Button>
						}
					>
						<Button onClick={() => disconnectMutation.mutate("slack")} disabled={disconnectMutation.isPending} variant="outline">
							<Show when={disconnectMutation.isPending}>
								<LoaderCircle class="w-4 h-4 animate-spin mr-2" />
							</Show>
							Disconnect
						</Button>
					</Show>
				</div>
			</div>
		</div>
	);
}
