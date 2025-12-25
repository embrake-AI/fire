import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createFileRoute, useNavigate } from "@tanstack/solid-router";
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
import { disconnectIntegration, getInstallUrl, getIntegrations } from "~/lib/integrations";

export const Route = createFileRoute("/_authed/config/integrations")({
	component: IntegrationsConfig,
	validateSearch: (search) => {
		return {
			installed: search.installed,
		};
	},
});

function IntegrationsConfig() {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Integrations</CardTitle>
			</CardHeader>
			<Suspense fallback={<IntegrationsContentSkeleton />}>
				<IntegrationsContent />
			</Suspense>
		</Card>
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

function IntegrationsContent() {
	const params = Route.useSearch();
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	const getIntegrationsFn = useServerFn(getIntegrations);
	const integrationsQuery = useQuery(() => ({
		queryKey: ["integrations"],
		queryFn: getIntegrationsFn,
		staleTime: 60_000,
	}));

	onMount(() => {
		const installed = params().installed as string;
		if (installed) {
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
			const url = await getInstallUrlFn({ data: platform });
			if (url) {
				window.location.href = url;
			}
		} finally {
			setIsConnecting(false);
		}
	};

	const disconnectFn = useServerFn(disconnectIntegration);
	const disconnectMutation = useMutation(() => ({
		mutationFn: disconnectFn,
		onMutate: async ({ data }) => {
			await queryClient.cancelQueries({ queryKey: ["integrations"] });
			const previousData = queryClient.getQueryData<typeof integrationsQuery.data>(["integrations"]);
			queryClient.setQueryData(["integrations"], previousData?.filter((i) => i.platform !== data) ?? []);
			return { previousData };
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["integrations"] });
		},
		onError: (_err, _variables, context) => {
			if (context?.previousData) {
				queryClient.setQueryData(["integrations"], context.previousData);
			}
		},
	}));

	const handleDisconnect = (platform: "slack") => {
		disconnectMutation.mutate({ data: platform });
	};

	const isConnected = (platform: "slack") => {
		return integrationsQuery.data?.some((integration) => integration.platform === platform) ?? false;
	};

	return (
		<CardContent class="animate-in fade-in duration-300">
			<IntegrationCard
				name="Slack"
				icon={<SlackIcon class="size-8" />}
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
				<div class="flex items-center">
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
