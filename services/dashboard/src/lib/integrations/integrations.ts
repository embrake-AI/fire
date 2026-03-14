import { createServerFn } from "@tanstack/solid-start";
import { authMiddleware } from "~/lib/auth/auth-middleware";
import { requirePermission, requirePermissionFromData } from "~/lib/auth/authorization";
import {
	disconnectUserIntegrationForUser,
	disconnectWorkspaceIntegrationForClient,
	getGitHubWorkspaceConfigForClient,
	getInstallUrlForContext,
	getSlackBotChannelsForClient,
	getSlackEmojisForClient,
	getUserIntegrationsForUser,
	getWorkspaceIntegrationsForClient,
	updateGitHubRepositoryDescriptionsForClient,
} from "./integrations.server";

type WorkspacePlatform = "slack" | "notion" | "intercom" | "github";

export const getWorkspaceIntegrations = createServerFn({ method: "GET" })
	.middleware([authMiddleware, requirePermission("incident.read")])
	.handler(async ({ context }) => {
		return getWorkspaceIntegrationsForClient(context.clientId);
	});

export const getUserIntegrations = createServerFn({ method: "GET" })
	.middleware([authMiddleware, requirePermission("incident.read")])
	.handler(async ({ context }) => {
		return getUserIntegrationsForUser(context.userId);
	});

export const getInstallUrl = createServerFn({ method: "POST" })
	.middleware([
		authMiddleware,
		requirePermissionFromData<{ platform: WorkspacePlatform; type: "workspace" | "user" }>((input) =>
			input.type === "workspace" ? "settings.workspace.write" : "settings.account.write",
		),
	])
	.inputValidator((data: { platform: WorkspacePlatform; type: "workspace" | "user" }) => data)
	.handler(async ({ context, data }) => {
		return getInstallUrlForContext({
			clientId: context.clientId,
			userId: context.userId,
			platform: data.platform,
			type: data.type,
		});
	});

export const disconnectWorkspaceIntegration = createServerFn({ method: "POST" })
	.middleware([authMiddleware, requirePermission("settings.workspace.write")])
	.inputValidator((data: WorkspacePlatform) => data)
	.handler(async ({ context, data }) => {
		return disconnectWorkspaceIntegrationForClient(context.clientId, data);
	});

export const getGitHubWorkspaceConfig = createServerFn({ method: "GET" })
	.middleware([authMiddleware, requirePermission("settings.workspace.read")])
	.handler(async ({ context }) => {
		return getGitHubWorkspaceConfigForClient(context.clientId);
	});

export const updateGitHubRepositoryDescriptions = createServerFn({ method: "POST" })
	.middleware([authMiddleware, requirePermission("settings.workspace.write")])
	.inputValidator((data: { repositories: Array<{ owner: string; name: string; description: string }> }) => data)
	.handler(async ({ context, data }) => {
		return updateGitHubRepositoryDescriptionsForClient(context.clientId, data);
	});

export const disconnectUserIntegration = createServerFn({ method: "POST" })
	.middleware([authMiddleware, requirePermission("settings.account.write")])
	.inputValidator((data: "slack") => data)
	.handler(async ({ context, data }) => {
		return disconnectUserIntegrationForUser(context.userId, data);
	});

export const getSlackBotChannels = createServerFn({ method: "GET" })
	.middleware([authMiddleware, requirePermission("catalog.read")])
	.handler(async ({ context }) => {
		return getSlackBotChannelsForClient(context.clientId);
	});

export const getSlackEmojis = createServerFn({ method: "GET" })
	.middleware([authMiddleware, requirePermission("incident.read")])
	.handler(async ({ context }) => {
		return getSlackEmojisForClient(context.clientId);
	});
