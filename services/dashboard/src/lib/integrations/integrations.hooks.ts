import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { useServerFn } from "@tanstack/solid-start";
import type { Accessor } from "solid-js";
import { runDemoAware } from "../demo/runtime";
import { disconnectUserIntegrationDemo, disconnectWorkspaceIntegrationDemo, getSlackEmojisDemo, getUserIntegrationsDemo, getWorkspaceIntegrationsDemo } from "../demo/store";
import { disconnectUserIntegration, disconnectWorkspaceIntegration, getSlackEmojis, getUserIntegrations, getWorkspaceIntegrations } from "./integrations";

export function useIntegrations(options?: { type?: "workspace" | "user"; enabled?: Accessor<boolean> }) {
	const getWorkspaceIntegrationsFn = useServerFn(getWorkspaceIntegrations);
	const getUserIntegrationsFn = useServerFn(getUserIntegrations);
	const type = options ? (options.type ?? "workspace") : "workspace";

	return useQuery(() => ({
		queryKey: type === "workspace" ? ["workspace_integrations"] : ["user_integrations"],
		queryFn: () =>
			runDemoAware({
				demo: () => (type === "workspace" ? getWorkspaceIntegrationsDemo() : getUserIntegrationsDemo()),
				remote: () => (type === "workspace" ? getWorkspaceIntegrationsFn() : getUserIntegrationsFn()),
			}),
		staleTime: 60_000,
		enabled: options?.enabled?.() ?? true,
	}));
}

export function useDisconnectWorkspaceIntegration() {
	const queryClient = useQueryClient();
	const disconnectWorkspaceIntegrationFn = useServerFn(disconnectWorkspaceIntegration);

	return useMutation(() => ({
		mutationFn: (platform: "slack") =>
			runDemoAware({
				demo: () => disconnectWorkspaceIntegrationDemo(platform),
				remote: () => disconnectWorkspaceIntegrationFn({ data: platform }),
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["workspace_integrations"] });
			queryClient.invalidateQueries({ queryKey: ["users"] });
		},
	}));
}

export function useDisconnectUserIntegration() {
	const queryClient = useQueryClient();
	const disconnectUserIntegrationFn = useServerFn(disconnectUserIntegration);

	return useMutation(() => ({
		mutationFn: (platform: "slack") =>
			runDemoAware({
				demo: () => disconnectUserIntegrationDemo(platform),
				remote: () => disconnectUserIntegrationFn({ data: platform }),
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["user_integrations"] });
			queryClient.invalidateQueries({ queryKey: ["users"] });
		},
	}));
}

export function useSlackEmojis() {
	const getSlackEmojisFn = useServerFn(getSlackEmojis);

	return useQuery(() => ({
		queryKey: ["slack-emojis"],
		queryFn: () =>
			runDemoAware({
				demo: () => getSlackEmojisDemo(),
				remote: () => getSlackEmojisFn(),
			}),
		staleTime: 1000 * 60 * 30, // 30 minutes
		retry: false,
	}));
}
