import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createFileRoute } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { LoaderCircle } from "lucide-solid";
import { createEffect, createSignal, onMount, Show, Suspense } from "solid-js";
import { IntercomIcon } from "~/components/icons/IntercomIcon";
import { NotionIcon } from "~/components/icons/NotionIcon";
import { SlackIcon } from "~/components/icons/SlackIcon";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Skeleton } from "~/components/ui/skeleton";
import { showToast } from "~/components/ui/toast";
import { requireRoutePermission } from "~/lib/auth/route-guards";
import { runDemoAware } from "~/lib/demo/runtime";
import { connectWorkspaceIntegrationDemo, disconnectWorkspaceIntegrationDemo, getIntercomWorkspaceConfigDemo, setIntercomStatusPageDemo } from "~/lib/demo/store";
import { disconnectWorkspaceIntegration, getInstallUrl } from "~/lib/integrations/integrations";
import { useIntegrations } from "~/lib/integrations/integrations.hooks";
import { getIntercomWorkspaceConfig, setIntercomStatusPage } from "~/lib/intercom/intercom";
import { useStatusPages } from "~/lib/status-pages/status-pages.hooks";

export const Route = createFileRoute("/_authed/settings/workspace/integrations")({
	beforeLoad: requireRoutePermission("settings.workspace.read"),
	component: WorkspaceIntegrationsPage,
	validateSearch: (search) => ({
		installed: typeof search.installed === "string" ? search.installed : undefined,
	}),
});

type WorkspacePlatform = "slack" | "notion" | "intercom";

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
	const statusPagesQuery = useStatusPages();
	const getInstallUrlFn = useServerFn(getInstallUrl);
	const getIntercomWorkspaceConfigFn = useServerFn(getIntercomWorkspaceConfig);
	const setIntercomStatusPageFn = useServerFn(setIntercomStatusPage);
	const [isConnecting, setIsConnecting] = createSignal(false);
	const [selectedStatusPageId, setSelectedStatusPageId] = createSignal("");

	const intercomConfigQuery = useQuery(() => ({
		queryKey: ["workspace_intercom_config"],
		queryFn: () =>
			runDemoAware({
				demo: () => getIntercomWorkspaceConfigDemo(),
				remote: () => getIntercomWorkspaceConfigFn(),
			}),
		staleTime: 60_000,
	}));

	createEffect(() => {
		setSelectedStatusPageId(intercomConfigQuery.data?.statusPageId ?? "");
	});

	onMount(() => {
		const installed = params().installed ?? null;
		if (installed) {
			queryClient.invalidateQueries({ queryKey: ["users"] });
			showToast({
				title: "Integration connected",
				description: `${installed} has been successfully connected to your workspace.`,
				variant: "success",
			});
			navigate({ to: ".", search: { installed: undefined }, replace: true });
		}
	});

	const handleConnect = async (platform: WorkspacePlatform) => {
		setIsConnecting(true);
		try {
			const url = await runDemoAware({
				demo: async () => {
					await connectWorkspaceIntegrationDemo(platform);
					await queryClient.invalidateQueries({ queryKey: ["workspace_integrations"] });
					await queryClient.invalidateQueries({ queryKey: ["workspace_intercom_config"] });
					return null;
				},
				remote: () => getInstallUrlFn({ data: { platform, type: "workspace" } }),
			});
			if (url) {
				window.location.href = url;
			}
		} finally {
			setIsConnecting(false);
		}
	};

	const disconnectFn = useServerFn(disconnectWorkspaceIntegration);
	const disconnectMutation = useMutation(() => ({
		mutationFn: (platform: WorkspacePlatform) =>
			runDemoAware({
				demo: () => disconnectWorkspaceIntegrationDemo(platform),
				remote: () => disconnectFn({ data: platform }),
			}),
		onSuccess: async (_, platform) => {
			await queryClient.invalidateQueries({ queryKey: ["workspace_integrations"] });
			await queryClient.invalidateQueries({ queryKey: ["workspace_intercom_config"] });
			await queryClient.invalidateQueries({ queryKey: ["users"] });
			showToast({
				title: "Integration disconnected",
				description: `${platform} has been successfully disconnected from your workspace.`,
				variant: "success",
			});
		},
	}));

	const setStatusPageMutation = useMutation(() => ({
		mutationFn: (statusPageId: string) =>
			runDemoAware({
				demo: () => setIntercomStatusPageDemo({ statusPageId }),
				remote: () => setIntercomStatusPageFn({ data: { statusPageId } }),
			}),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["workspace_intercom_config"] });
			showToast({
				title: "Intercom updated",
				description: "Status page mapping was saved.",
				variant: "success",
			});
		},
	}));

	const isConnected = (platform: WorkspacePlatform) => {
		return integrationsQuery.data?.some((i) => i.platform === platform) ?? false;
	};

	const statusPageOptions = () => (statusPagesQuery.data ?? []).map((page) => ({ id: page.id, name: page.name.trim() || "Untitled status page" }));

	const hasSelectedStatusPage = () => selectedStatusPageId().trim().length > 0;
	const configuredStatusPageId = () => intercomConfigQuery.data?.statusPageId ?? "";
	const isIntercomMissingConfiguration = () => isConnected("intercom") && !configuredStatusPageId();
	const isSaveDisabled = () => !hasSelectedStatusPage() || selectedStatusPageId() === configuredStatusPageId() || setStatusPageMutation.isPending;

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
				<div class="flex items-center justify-between py-3">
					<div class="flex items-center gap-3">
						<div class="flex items-center justify-center size-10 rounded-lg bg-muted">
							<NotionIcon class="size-5" />
						</div>
						<span class="text-sm font-medium text-foreground">Notion</span>
						<Show when={isConnected("notion")}>
							<Badge class="bg-emerald-100 text-emerald-700 border-emerald-200">Connected</Badge>
						</Show>
					</div>
					<Show
						when={isConnected("notion")}
						fallback={
							<Button onClick={() => handleConnect("notion")} disabled={isConnecting()}>
								<Show when={isConnecting()}>
									<LoaderCircle class="w-4 h-4 animate-spin mr-2" />
								</Show>
								Connect
							</Button>
						}
					>
						<Button onClick={() => disconnectMutation.mutate("notion")} disabled={disconnectMutation.isPending} variant="outline">
							<Show when={disconnectMutation.isPending}>
								<LoaderCircle class="w-4 h-4 animate-spin mr-2" />
							</Show>
							Disconnect
						</Button>
					</Show>
				</div>
				<div class="py-3 space-y-3">
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-3">
							<div class="flex items-center justify-center size-10 rounded-lg bg-muted text-black">
								<IntercomIcon class="size-5" />
							</div>
							<span class="text-sm font-medium text-foreground">Intercom</span>
							<Show when={isConnected("intercom")}>
								<Badge class="bg-emerald-100 text-emerald-700 border-emerald-200">Connected</Badge>
							</Show>
							<Show when={isIntercomMissingConfiguration()}>
								<Badge class="bg-amber-100 text-amber-800 border-amber-200">Missing configuration</Badge>
							</Show>
						</div>
						<Show
							when={isConnected("intercom")}
							fallback={
								<Button onClick={() => handleConnect("intercom")} disabled={isConnecting()}>
									<Show when={isConnecting()}>
										<LoaderCircle class="w-4 h-4 animate-spin mr-2" />
									</Show>
									Connect
								</Button>
							}
						>
							<Button onClick={() => disconnectMutation.mutate("intercom")} disabled={disconnectMutation.isPending} variant="outline">
								<Show when={disconnectMutation.isPending}>
									<LoaderCircle class="w-4 h-4 animate-spin mr-2" />
								</Show>
								Disconnect
							</Button>
						</Show>
					</div>

					<Show when={isConnected("intercom")}>
						<div class="flex items-center gap-2">
							<span class="text-xs text-muted-foreground min-w-24">Status page</span>
							<Select
								value={selectedStatusPageId()}
								onChange={(value) => setSelectedStatusPageId((value as string) ?? "")}
								options={statusPageOptions().map((page) => page.id)}
								itemComponent={(props) => {
									const page = statusPageOptions().find((item) => item.id === props.item.rawValue);
									return <SelectItem item={props.item}>{page?.name ?? "Unknown status page"}</SelectItem>;
								}}
							>
								<SelectTrigger class="flex-1">
									<SelectValue<string>>
										{(state) => {
											const page = statusPageOptions().find((item) => item.id === state.selectedOption());
											return page?.name ?? "Select a status page";
										}}
									</SelectValue>
								</SelectTrigger>
								<SelectContent />
							</Select>
							<Button onClick={() => setStatusPageMutation.mutate(selectedStatusPageId())} disabled={isSaveDisabled()}>
								<Show when={setStatusPageMutation.isPending}>
									<LoaderCircle class="w-4 h-4 animate-spin mr-2" />
								</Show>
								Save
							</Button>
						</div>
					</Show>
				</div>
			</div>
		</div>
	);
}
