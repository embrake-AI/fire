import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createFileRoute } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { ChevronDown, LoaderCircle, Settings2 } from "lucide-solid";
import { createEffect, createSignal, Index, onMount, Show, Suspense } from "solid-js";
import { GitHubIcon } from "~/components/icons/GitHubIcon";
import { IntercomIcon } from "~/components/icons/IntercomIcon";
import { NotionIcon } from "~/components/icons/NotionIcon";
import { SlackIcon } from "~/components/icons/SlackIcon";
import { AutoSaveTextarea } from "~/components/ui/auto-save-textarea";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Skeleton } from "~/components/ui/skeleton";
import { showToast } from "~/components/ui/toast";
import { requireRoutePermission } from "~/lib/auth/route-guards";
import { runDemoAware } from "~/lib/demo/runtime";
import { connectWorkspaceIntegrationDemo, getIntercomWorkspaceConfigDemo, setIntercomStatusPageDemo } from "~/lib/demo/store";
import {
	useDisconnectWorkspaceIntegration,
	useGitHubWorkspaceConfig,
	useInstallUrl,
	useIntegrations,
	useUpdateGitHubRepositoryDescriptions,
} from "~/lib/integrations/integrations.hooks";
import { getIntercomWorkspaceConfig, setIntercomStatusPage } from "~/lib/intercom/intercom";
import { useStatusPages } from "~/lib/status-pages/status-pages.hooks";

export const Route = createFileRoute("/_authed/settings/workspace/integrations")({
	beforeLoad: requireRoutePermission("settings.workspace.read"),
	component: WorkspaceIntegrationsPage,
	validateSearch: (search) => ({
		installed: typeof search.installed === "string" ? search.installed : undefined,
	}),
});

type WorkspacePlatform = "slack" | "notion" | "intercom" | "github";

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
	const getInstallUrlFn = useInstallUrl();
	const getIntercomWorkspaceConfigFn = useServerFn(getIntercomWorkspaceConfig);
	const setIntercomStatusPageFn = useServerFn(setIntercomStatusPage);
	const [isConnecting, setIsConnecting] = createSignal(false);
	const [selectedStatusPageId, setSelectedStatusPageId] = createSignal("");
	const [githubConfigOpen, setGitHubConfigOpen] = createSignal(false);
	const [openGitHubRepoKey, setOpenGitHubRepoKey] = createSignal<string | null>(null);
	const [intercomConfigOpen, setIntercomConfigOpen] = createSignal(false);

	const intercomConfigQuery = useQuery(() => ({
		queryKey: ["workspace_intercom_config"],
		queryFn: () =>
			runDemoAware({
				demo: () => getIntercomWorkspaceConfigDemo(),
				remote: () => getIntercomWorkspaceConfigFn(),
			}),
		staleTime: 60_000,
	}));

	const githubConfigQuery = useGitHubWorkspaceConfig();

	createEffect(() => {
		setSelectedStatusPageId(intercomConfigQuery.data?.statusPageId ?? "");
	});

	createEffect(() => {
		const repositories = githubConfigQuery.data?.repositories ?? [];
		const firstKey = repositories[0] ? `${repositories[0].owner}/${repositories[0].name}` : null;
		const currentKey = openGitHubRepoKey();
		const hasCurrentKey = repositories.some((repo) => `${repo.owner}/${repo.name}` === currentKey);
		if (!hasCurrentKey) {
			setOpenGitHubRepoKey(firstKey);
		}
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
			if (installed === "github") {
				setGitHubConfigOpen(true);
			}
			if (installed === "intercom") {
				setIntercomConfigOpen(true);
			}
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
					await queryClient.invalidateQueries({ queryKey: ["workspace_github_config"] });
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

	const disconnectMutation = useDisconnectWorkspaceIntegration({
		onSuccess: async (platform) => {
			showToast({
				title: "Integration disconnected",
				description: `${platform} has been successfully disconnected from your workspace.`,
				variant: "success",
			});
		},
	});

	const updateGitHubDescriptionsMutation = useUpdateGitHubRepositoryDescriptions();

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
	const githubRepositories = () => githubConfigQuery.data?.repositories ?? [];

	const handleSaveGitHubDescription = async (owner: string, name: string, description: string) => {
		await updateGitHubDescriptionsMutation.mutateAsync([{ owner, name, description }]);
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
							<div class="flex items-center justify-center size-10 rounded-lg bg-muted">
								<GitHubIcon class="size-5" />
							</div>
							<span class="text-sm font-medium text-foreground">GitHub</span>
							<Show when={isConnected("github")}>
								<Badge class="bg-emerald-100 text-emerald-700 border-emerald-200">Connected</Badge>
							</Show>
						</div>
						<Show
							when={isConnected("github")}
							fallback={
								<Button onClick={() => handleConnect("github")} disabled={isConnecting()}>
									<Show when={isConnecting()}>
										<LoaderCircle class="w-4 h-4 animate-spin mr-2" />
									</Show>
									Connect
								</Button>
							}
						>
							<div class="flex items-center gap-2">
								<Button variant="ghost" size="icon" class="size-9" onClick={() => setGitHubConfigOpen(true)} aria-label="Configure GitHub repositories">
									<Settings2 class="size-4" />
								</Button>
								<Button onClick={() => disconnectMutation.mutate("github")} disabled={disconnectMutation.isPending} variant="outline">
									<Show when={disconnectMutation.isPending}>
										<LoaderCircle class="w-4 h-4 animate-spin mr-2" />
									</Show>
									Disconnect
								</Button>
							</div>
						</Show>
					</div>
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
							<div class="flex items-center gap-2">
								<Button variant="ghost" size="icon" class="size-9" onClick={() => setIntercomConfigOpen(true)} aria-label="Configure Intercom">
									<Settings2 class="size-4" />
								</Button>
								<Button onClick={() => disconnectMutation.mutate("intercom")} disabled={disconnectMutation.isPending} variant="outline">
									<Show when={disconnectMutation.isPending}>
										<LoaderCircle class="w-4 h-4 animate-spin mr-2" />
									</Show>
									Disconnect
								</Button>
							</div>
						</Show>
					</div>
				</div>
			</div>

			<Dialog open={githubConfigOpen()} onOpenChange={setGitHubConfigOpen}>
				<DialogContent class="sm:max-w-3xl">
					<DialogHeader>
						<DialogTitle>Configure GitHub repositories</DialogTitle>
						<DialogDescription>
							Repository descriptions are included in the agent&apos;s first prompt. Keep them specific to ownership, deploy surface, and the kinds of incidents each repo commonly
							explains.
						</DialogDescription>
					</DialogHeader>

					<div class="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
						<Index each={githubRepositories()}>
							{(repo) => {
								const key = `${repo().owner}/${repo().name}`;
								const isOpen = () => openGitHubRepoKey() === key;
								return (
									<div class="rounded-lg border border-border/60 bg-muted/10 p-4 space-y-3">
										<button
											type="button"
											class="flex w-full items-start justify-between gap-4 text-left"
											onClick={() => setOpenGitHubRepoKey((current) => (current === key ? null : key))}
										>
											<div>
												<p class="text-sm font-medium text-foreground">
													{repo().owner}/{repo().name}
												</p>
												<p class="text-xs text-muted-foreground">Default branch: {repo().defaultBranch}</p>
											</div>
											<ChevronDown class={`mt-0.5 size-4 text-muted-foreground transition-transform ${isOpen() ? "rotate-180" : ""}`} />
										</button>
										<Show when={isOpen()}>
											<AutoSaveTextarea
												id={`github-repo-description-${repo().owner}-${repo().name}`}
												value={repo().description}
												onSave={(value) => handleSaveGitHubDescription(repo().owner, repo().name, value)}
												rows={20}
												placeholder="Describe what this repository owns and what kinds of incidents it commonly explains."
											/>
										</Show>
									</div>
								);
							}}
						</Index>
					</div>

					<DialogFooter class="gap-2">
						<Button variant="outline" onClick={() => setGitHubConfigOpen(false)}>
							Close
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog open={intercomConfigOpen()} onOpenChange={setIntercomConfigOpen}>
				<DialogContent class="sm:max-w-xl">
					<DialogHeader>
						<DialogTitle>Configure Intercom</DialogTitle>
						<DialogDescription>Choose which status page Intercom incidents should link to.</DialogDescription>
					</DialogHeader>

					<div class="space-y-3">
						<p class="text-xs text-muted-foreground">Status page</p>
						<Select
							value={selectedStatusPageId()}
							onChange={(value) => setSelectedStatusPageId((value as string) ?? "")}
							options={statusPageOptions().map((page) => page.id)}
							itemComponent={(props) => {
								const page = statusPageOptions().find((item) => item.id === props.item.rawValue);
								return <SelectItem item={props.item}>{page?.name ?? "Unknown status page"}</SelectItem>;
							}}
						>
							<SelectTrigger class="w-full">
								<SelectValue<string>>
									{(state) => {
										const page = statusPageOptions().find((item) => item.id === state.selectedOption());
										return page?.name ?? "Select a status page";
									}}
								</SelectValue>
							</SelectTrigger>
							<SelectContent />
						</Select>
					</div>

					<DialogFooter class="gap-2">
						<Button variant="outline" onClick={() => setIntercomConfigOpen(false)}>
							Close
						</Button>
						<Button onClick={() => setStatusPageMutation.mutate(selectedStatusPageId())} disabled={isSaveDisabled()}>
							<Show when={setStatusPageMutation.isPending}>
								<LoaderCircle class="w-4 h-4 animate-spin mr-2" />
							</Show>
							Save
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
