import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { useServerFn } from "@tanstack/solid-start";
import type { Accessor } from "solid-js";
import { runDemoAware } from "../demo/runtime";
import {
	disconnectUserIntegrationDemo,
	disconnectWorkspaceIntegrationDemo,
	getGitHubWorkspaceConfigDemo,
	getSlackBotChannelsDemo,
	getSlackEmojisDemo,
	getUserIntegrationsDemo,
	getWorkspaceIntegrationsDemo,
	updateGitHubRepositoryDescriptionsDemo,
} from "../demo/store";
import {
	disconnectUserIntegration,
	disconnectWorkspaceIntegration,
	getGitHubWorkspaceConfig,
	getInstallUrl,
	getSlackBotChannels,
	getSlackEmojis,
	getUserIntegrations,
	getWorkspaceIntegrations,
	updateGitHubRepositoryDescriptions,
} from "./integrations";

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

export function useInstallUrl() {
	return useServerFn(getInstallUrl);
}

export function useDisconnectWorkspaceIntegration(options?: { onSuccess?: (platform: "slack" | "notion" | "intercom" | "github") => void | Promise<void> }) {
	const queryClient = useQueryClient();
	const disconnectWorkspaceIntegrationFn = useServerFn(disconnectWorkspaceIntegration);

	return useMutation(() => ({
		mutationFn: (platform: "slack" | "notion" | "intercom" | "github") =>
			runDemoAware({
				demo: () => disconnectWorkspaceIntegrationDemo(platform),
				remote: () => disconnectWorkspaceIntegrationFn({ data: platform }),
			}),
		onSuccess: async (_, platform) => {
			queryClient.invalidateQueries({ queryKey: ["workspace_integrations"] });
			queryClient.invalidateQueries({ queryKey: ["workspace_intercom_config"] });
			queryClient.invalidateQueries({ queryKey: ["workspace_github_config"] });
			queryClient.invalidateQueries({ queryKey: ["users"] });
			await options?.onSuccess?.(platform);
		},
	}));
}

export function useDisconnectUserIntegration(options?: { onSuccess?: (platform: "slack") => void | Promise<void> }) {
	const queryClient = useQueryClient();
	const disconnectUserIntegrationFn = useServerFn(disconnectUserIntegration);

	return useMutation(() => ({
		mutationFn: (platform: "slack") =>
			runDemoAware({
				demo: () => disconnectUserIntegrationDemo(platform),
				remote: () => disconnectUserIntegrationFn({ data: platform }),
			}),
		onSuccess: async (_, platform) => {
			queryClient.invalidateQueries({ queryKey: ["user_integrations"] });
			queryClient.invalidateQueries({ queryKey: ["users"] });
			await options?.onSuccess?.(platform);
		},
	}));
}

export function useGitHubWorkspaceConfig(options?: { enabled?: Accessor<boolean> }) {
	const getGitHubWorkspaceConfigFn = useServerFn(getGitHubWorkspaceConfig);

	return useQuery(() => ({
		queryKey: ["workspace_github_config"],
		queryFn: () =>
			runDemoAware({
				demo: () => getGitHubWorkspaceConfigDemo(),
				remote: () => getGitHubWorkspaceConfigFn(),
			}),
		staleTime: 60_000,
		enabled: options?.enabled?.() ?? true,
	}));
}

export function useUpdateGitHubRepositoryDescriptions(options?: { onSuccess?: () => void | Promise<void> }) {
	const queryClient = useQueryClient();
	const updateGitHubRepositoryDescriptionsFn = useServerFn(updateGitHubRepositoryDescriptions);

	return useMutation(() => ({
		mutationFn: (repositories: Array<{ owner: string; name: string; description: string }>) =>
			runDemoAware({
				demo: () => updateGitHubRepositoryDescriptionsDemo({ repositories }),
				remote: () => updateGitHubRepositoryDescriptionsFn({ data: { repositories } }),
			}),
		onSuccess: async (_, repositories) => {
			const updates = new Map(repositories.map((repo) => [`${repo.owner}/${repo.name}`, repo.description]));
			queryClient.setQueryData(["workspace_github_config"], (current) => {
				if (!current || typeof current !== "object" || !("repositories" in current) || !Array.isArray(current.repositories)) {
					return current;
				}

				return {
					...current,
					repositories: current.repositories.map((repo) => {
						if (!repo || typeof repo !== "object" || !("owner" in repo) || !("name" in repo) || typeof repo.owner !== "string" || typeof repo.name !== "string") {
							return repo;
						}

						const description = updates.get(`${repo.owner}/${repo.name}`);
						return description === undefined ? repo : { ...repo, description };
					}),
				};
			});
			await options?.onSuccess?.();
		},
	}));
}

export function useSlackBotChannels(options?: { enabled?: Accessor<boolean> }) {
	const getSlackBotChannelsFn = useServerFn(getSlackBotChannels);

	return useQuery(() => ({
		queryKey: ["slack-bot-channels"],
		queryFn: () =>
			runDemoAware({
				demo: () => getSlackBotChannelsDemo(),
				remote: () => getSlackBotChannelsFn(),
			}),
		enabled: options?.enabled?.() ?? true,
		staleTime: Infinity,
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
