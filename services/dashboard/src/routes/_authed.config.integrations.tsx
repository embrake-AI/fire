import { useMutation, useQueryClient } from "@tanstack/solid-query";
import { createFileRoute } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { LoaderCircle } from "lucide-solid";
import type { Accessor, JSX } from "solid-js";
import { createSignal, onMount, Show, Suspense } from "solid-js";
import { SlackIcon } from "~/components/icons/SlackIcon";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { showToast } from "~/components/ui/toast";
import { disconnectUserIntegration, disconnectWorkspaceIntegration, getInstallUrl, type getUserIntegrations, type getWorkspaceIntegrations } from "~/lib/integrations/integrations";
import { useIntegrations } from "~/lib/integrations/integrations.hooks";

type WorkspaceIntegrationsData = Awaited<ReturnType<typeof getWorkspaceIntegrations>>;
type UserIntegrationsData = Awaited<ReturnType<typeof getUserIntegrations>>;

export const Route = createFileRoute("/_authed/config/integrations")({
	component: IntegrationsConfig,
	validateSearch: (search) => {
		if ("installed" in search) {
			return {
				installed: search.installed,
			};
		} else {
			return {};
		}
	},
});

function IntegrationsConfig() {
	return (
		<div class="space-y-6">
			<Card>
				<CardHeader>
					<CardTitle>Workspace Integrations</CardTitle>
				</CardHeader>
				<Suspense fallback={<IntegrationsContentSkeleton />}>
					<WorkspaceIntegrationsContent />
				</Suspense>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>My Integrations</CardTitle>
				</CardHeader>
				<Suspense fallback={<IntegrationsContentSkeleton />}>
					<UserIntegrationsContent />
				</Suspense>
			</Card>
		</div>
	);
}

function IntegrationsContentSkeleton() {
	return (
		<CardContent>
			<div class="flex items-center justify-between py-2">
				<div class="flex items-center gap-3">
					<Skeleton class="size-8 rounded" />
					<Skeleton variant="text" class="h-5 w-16" />
				</div>
				<Skeleton class="h-8 w-24 rounded-md" />
			</div>
		</CardContent>
	);
}

function WorkspaceIntegrationsContent() {
	const params = Route.useSearch();
	const navigate = Route.useNavigate();
	const queryClient = useQueryClient();

	const integrationsQuery = useIntegrations({ type: "workspace" });

	onMount(() => {
		const installed = params().installed as string;
		if (installed) {
			// Invalidate users query to refresh integration status
			queryClient.invalidateQueries({ queryKey: ["users"] });
			showToast({
				title: "Integration connected",
				description: `${installed} has been successfully connected to your workspace.`,
				variant: "success",
			});
			navigate({ to: ".", search: {}, replace: true });
		}
	});

	const getInstallUrlFn = useServerFn(getInstallUrl);
	const [isConnecting, setIsConnecting] = createSignal(false);

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
		onMutate: async (platform) => {
			await queryClient.cancelQueries({ queryKey: ["workspace_integrations"] });
			const previousData = queryClient.getQueryData<WorkspaceIntegrationsData>(["workspace_integrations"]);
			if (previousData) {
				queryClient.setQueryData(
					["workspace_integrations"],
					previousData.filter((i) => i.platform !== platform),
				);
			}
			return { previousData };
		},
		onSuccess: async (_, platform) => {
			await queryClient.invalidateQueries({ queryKey: ["workspace_integrations"] });
			await queryClient.invalidateQueries({ queryKey: ["users"] });
			showToast({
				title: "Integration disconnected",
				description: `${platform} has been successfully disconnected from your workspace.`,
				variant: "success",
			});
		},
		onError: (_err, _variables, context) => {
			if (context?.previousData) {
				queryClient.setQueryData(["workspace_integrations"], context.previousData);
			}
		},
	}));

	const handleDisconnect = (platform: "slack") => {
		disconnectMutation.mutate(platform);
	};

	const isConnected = (platform: "slack") => {
		return integrationsQuery.data?.some((i) => i.platform === platform) ?? false;
	};

	return (
		<CardContent>
			<IntegrationCard
				name="Slack"
				icon={<SlackIcon class="size-4" />}
				connected={() => isConnected("slack")}
				onConnect={() => handleConnect("slack")}
				loading={isConnecting() || disconnectMutation.isPending}
				onDisconnect={() => handleDisconnect("slack")}
			/>
		</CardContent>
	);
}

function UserIntegrationsContent() {
	const queryClient = useQueryClient();

	const integrationsQuery = useIntegrations({ type: "user" });

	const getInstallUrlFn = useServerFn(getInstallUrl);
	const [isConnecting, setIsConnecting] = createSignal(false);

	const handleConnect = async (platform: "slack") => {
		setIsConnecting(true);
		try {
			const url = await getInstallUrlFn({ data: { platform, type: "user" } });
			if (url) {
				window.location.href = url;
			}
		} finally {
			setIsConnecting(false);
		}
	};

	const disconnectFn = useServerFn(disconnectUserIntegration);
	const disconnectMutation = useMutation(() => ({
		mutationFn: (platform: "slack") => disconnectFn({ data: platform }),
		onMutate: async (platform) => {
			await queryClient.cancelQueries({ queryKey: ["user_integrations"] });
			const previousData = queryClient.getQueryData<UserIntegrationsData>(["user_integrations"]);
			if (previousData) {
				queryClient.setQueryData(
					["user_integrations"],
					previousData.filter((i) => i.platform !== platform),
				);
			}
			return { previousData };
		},
		onSuccess: async (_, platform) => {
			await queryClient.invalidateQueries({ queryKey: ["user_integrations"] });
			await queryClient.invalidateQueries({ queryKey: ["users"] });
			showToast({
				title: "Integration disconnected",
				description: `${platform} has been successfully disconnected from your user account.`,
				variant: "success",
			});
		},
		onError: (_err, _variables, context) => {
			if (context?.previousData) {
				queryClient.setQueryData(["user_integrations"], context.previousData);
			}
		},
	}));

	const handleDisconnect = (platform: "slack") => {
		disconnectMutation.mutate(platform);
	};

	const isConnected = (platform: "slack") => {
		return integrationsQuery.data?.some((i) => i.platform === platform) ?? false;
	};

	return (
		<CardContent>
			<IntegrationCard
				name="Slack"
				icon={<SlackIcon class="size-4" />}
				connected={() => isConnected("slack")}
				onConnect={() => handleConnect("slack")}
				loading={isConnecting() || disconnectMutation.isPending}
				onDisconnect={() => handleDisconnect("slack")}
			/>
		</CardContent>
	);
}

type IntegrationCardProps = {
	/** Integration name displayed to user */
	name: string;
	/** Icon component for the integration */
	icon: JSX.Element;
	/** Whether the integration is currently connected */
	connected: Accessor<boolean>;
	/** Whether the connect/disconnect action is loading */
	loading?: boolean;
	/** Callback when disconnect is clicked */
	onDisconnect?: () => void;
	/** Callback when connect is clicked */
	onConnect?: () => void;
};

function IntegrationCard(props: IntegrationCardProps) {
	return (
		<div class="flex items-center justify-between py-2">
			<div class="flex items-center">
				<div class="flex items-center gap-2">
					{props.icon}
					<span class="font-medium text-foreground">{props.name}</span>
				</div>
				<Show when={props.connected()}>
					<Badge class="ml-4 bg-emerald-100 text-emerald-700 border-emerald-200">Connected</Badge>
				</Show>
			</div>
			<Show
				when={props.connected()}
				fallback={
					<Button onClick={props.onConnect} disabled={props.loading} size="sm">
						<Show when={props.loading}>
							<LoaderCircle class="w-3.5 h-3.5 animate-spin" />
						</Show>
						Connect
					</Button>
				}
			>
				<Button onClick={props.onDisconnect} disabled={props.loading} variant="outline" size="sm">
					<Show when={props.loading}>
						<LoaderCircle class="w-3.5 h-3.5 animate-spin" />
					</Show>
					Disconnect
				</Button>
			</Show>
		</div>
	);
}
