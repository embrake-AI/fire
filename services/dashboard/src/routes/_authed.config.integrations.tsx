import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createFileRoute, useNavigate } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { createEffect, createSignal, on } from "solid-js";
import { IntegrationCard } from "~/components/IntegrationCard";
import { SlackIcon } from "~/components/icons/SlackIcon";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { showToast } from "~/components/ui/toast";
import { disconnectIntegration, getInstallUrl, getIntegrations } from "~/lib/integrations";

export const Route = createFileRoute("/_authed/config/integrations")({
	component: IntegrationsConfig,
	validateSearch: (search) => {
		return {
			installed: search.installed,
		};
	},
	loader: async ({ context }) => {
		// We force fetch as it's hard to keep state with the redirect
		return context.queryClient.fetchQuery({
			queryKey: ["integrations"],
			queryFn: getIntegrations,
		});
	},
});

function IntegrationsConfig() {
	const loaderData = Route.useLoaderData();
	const params = Route.useSearch();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const getIntegrationsFn = useServerFn(getIntegrations);

	const integrationsQuery = useQuery(() => ({
		queryKey: ["integrations"],
		queryFn: getIntegrationsFn,
		staleTime: 60_000,
		initialData: loaderData(),
	}));

	createEffect(
		on(
			() => params().installed,
			(installed) => {
				if (installed) {
					integrationsQuery.refetch();
					showToast({
						title: "Integration connected",
						description: "Slack has been successfully connected to your workspace.",
						variant: "success",
					});
					navigate({ to: ".", search: {}, replace: true });
				}
			},
			{ defer: false },
		),
	);

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
		<Card>
			<CardHeader>
				<CardTitle>Integrations</CardTitle>
			</CardHeader>
			<CardContent>
				<IntegrationCard
					name="Slack"
					icon={<SlackIcon class="size-8" />}
					connected={() => isConnected("slack")}
					onConnect={() => handleConnect("slack")}
					loading={isConnecting() || disconnectMutation.isPending}
					onDisconnect={() => handleDisconnect("slack")}
				/>
			</CardContent>
		</Card>
	);
}
