import { useMutation, useQueryClient } from "@tanstack/solid-query";
import { createFileRoute } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { LoaderCircle } from "lucide-solid";
import { createSignal, Show, Suspense } from "solid-js";
import { SlackIcon } from "~/components/icons/SlackIcon";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { showToast } from "~/components/ui/toast";
import { requireRoutePermission } from "~/lib/auth/route-guards";
import { runDemoAware } from "~/lib/demo/runtime";
import { connectUserIntegrationDemo, disconnectUserIntegrationDemo } from "~/lib/demo/store";
import { disconnectUserIntegration, getInstallUrl } from "~/lib/integrations/integrations";
import { useIntegrations } from "~/lib/integrations/integrations.hooks";

export const Route = createFileRoute("/_authed/settings/account/integrations")({
	beforeLoad: requireRoutePermission("settings.account.read"),
	component: AccountIntegrationsPage,
});

function AccountIntegrationsPage() {
	return (
		<div class="space-y-8">
			<div>
				<h2 class="text-lg font-semibold text-foreground">Connected Accounts</h2>
				<p class="text-sm text-muted-foreground mt-1">Connect your personal accounts to interact with third-party services</p>
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
	const queryClient = useQueryClient();
	const integrationsQuery = useIntegrations({ type: "user" });
	const getInstallUrlFn = useServerFn(getInstallUrl);
	const [isConnecting, setIsConnecting] = createSignal(false);

	const handleConnect = async (platform: "slack") => {
		setIsConnecting(true);
		try {
			const url = await runDemoAware({
				demo: async () => {
					await connectUserIntegrationDemo(platform);
					await queryClient.invalidateQueries({ queryKey: ["user_integrations"] });
					return null;
				},
				remote: () => getInstallUrlFn({ data: { platform, type: "user" } }),
			});
			if (url) {
				window.location.href = url;
			}
		} finally {
			setIsConnecting(false);
		}
	};

	const disconnectFn = useServerFn(disconnectUserIntegration);
	const disconnectMutation = useMutation(() => ({
		mutationFn: (platform: "slack") =>
			runDemoAware({
				demo: () => disconnectUserIntegrationDemo(platform),
				remote: () => disconnectFn({ data: platform }),
			}),
		onSuccess: async (_, platform) => {
			await queryClient.invalidateQueries({ queryKey: ["user_integrations"] });
			await queryClient.invalidateQueries({ queryKey: ["users"] });
			showToast({
				title: "Integration disconnected",
				description: `${platform} has been successfully disconnected from your account.`,
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
