// Thin wrappers to keep demo implementation out of the default client bundle.
// `store.impl.ts` is loaded only when a demo function is actually invoked.
type StoreModule = typeof import("./store.impl");

async function callDemo<K extends keyof StoreModule>(name: K, ...args: Parameters<StoreModule[K]>): Promise<Awaited<ReturnType<StoreModule[K]>>> {
	const module = await import("./store.impl");
	const fn = module[name] as (...innerArgs: Parameters<StoreModule[K]>) => ReturnType<StoreModule[K]>;
	return await fn(...args);
}

export function resetDemoState(...args: Parameters<StoreModule["resetDemoState"]>): ReturnType<StoreModule["resetDemoState"]> {
	return callDemo("resetDemoState", ...args) as ReturnType<StoreModule["resetDemoState"]>;
}

export function getClientDemo(...args: Parameters<StoreModule["getClientDemo"]>): ReturnType<StoreModule["getClientDemo"]> {
	return callDemo("getClientDemo", ...args) as ReturnType<StoreModule["getClientDemo"]>;
}

export function updateClientDemo(...args: Parameters<StoreModule["updateClientDemo"]>): ReturnType<StoreModule["updateClientDemo"]> {
	return callDemo("updateClientDemo", ...args) as ReturnType<StoreModule["updateClientDemo"]>;
}

export function getUsersDemo(...args: Parameters<StoreModule["getUsersDemo"]>): ReturnType<StoreModule["getUsersDemo"]> {
	return callDemo("getUsersDemo", ...args) as ReturnType<StoreModule["getUsersDemo"]>;
}

export function getCurrentUserDemo(...args: Parameters<StoreModule["getCurrentUserDemo"]>): ReturnType<StoreModule["getCurrentUserDemo"]> {
	return callDemo("getCurrentUserDemo", ...args) as ReturnType<StoreModule["getCurrentUserDemo"]>;
}

export function updateUserDemo(...args: Parameters<StoreModule["updateUserDemo"]>): ReturnType<StoreModule["updateUserDemo"]> {
	return callDemo("updateUserDemo", ...args) as ReturnType<StoreModule["updateUserDemo"]>;
}

export function getWorkspaceUsersForManagementDemo(
	...args: Parameters<StoreModule["getWorkspaceUsersForManagementDemo"]>
): ReturnType<StoreModule["getWorkspaceUsersForManagementDemo"]> {
	return callDemo("getWorkspaceUsersForManagementDemo", ...args) as ReturnType<StoreModule["getWorkspaceUsersForManagementDemo"]>;
}

export function updateWorkspaceUserRoleDemo(...args: Parameters<StoreModule["updateWorkspaceUserRoleDemo"]>): ReturnType<StoreModule["updateWorkspaceUserRoleDemo"]> {
	return callDemo("updateWorkspaceUserRoleDemo", ...args) as ReturnType<StoreModule["updateWorkspaceUserRoleDemo"]>;
}

export function removeWorkspaceUserDemo(...args: Parameters<StoreModule["removeWorkspaceUserDemo"]>): ReturnType<StoreModule["removeWorkspaceUserDemo"]> {
	return callDemo("removeWorkspaceUserDemo", ...args) as ReturnType<StoreModule["removeWorkspaceUserDemo"]>;
}

export function getWorkspaceUserProvisioningSettingsDemo(
	...args: Parameters<StoreModule["getWorkspaceUserProvisioningSettingsDemo"]>
): ReturnType<StoreModule["getWorkspaceUserProvisioningSettingsDemo"]> {
	return callDemo("getWorkspaceUserProvisioningSettingsDemo", ...args) as ReturnType<StoreModule["getWorkspaceUserProvisioningSettingsDemo"]>;
}

export function updateWorkspaceUserProvisioningSettingsDemo(
	...args: Parameters<StoreModule["updateWorkspaceUserProvisioningSettingsDemo"]>
): ReturnType<StoreModule["updateWorkspaceUserProvisioningSettingsDemo"]> {
	return callDemo("updateWorkspaceUserProvisioningSettingsDemo", ...args) as ReturnType<StoreModule["updateWorkspaceUserProvisioningSettingsDemo"]>;
}

export function addWorkspaceUserFromSlackDemo(...args: Parameters<StoreModule["addWorkspaceUserFromSlackDemo"]>): ReturnType<StoreModule["addWorkspaceUserFromSlackDemo"]> {
	return callDemo("addWorkspaceUserFromSlackDemo", ...args) as ReturnType<StoreModule["addWorkspaceUserFromSlackDemo"]>;
}

export function getTeamsDemo(...args: Parameters<StoreModule["getTeamsDemo"]>): ReturnType<StoreModule["getTeamsDemo"]> {
	return callDemo("getTeamsDemo", ...args) as ReturnType<StoreModule["getTeamsDemo"]>;
}

export function createTeamDemo(...args: Parameters<StoreModule["createTeamDemo"]>): ReturnType<StoreModule["createTeamDemo"]> {
	return callDemo("createTeamDemo", ...args) as ReturnType<StoreModule["createTeamDemo"]>;
}

export function deleteTeamDemo(...args: Parameters<StoreModule["deleteTeamDemo"]>): ReturnType<StoreModule["deleteTeamDemo"]> {
	return callDemo("deleteTeamDemo", ...args) as ReturnType<StoreModule["deleteTeamDemo"]>;
}

export function addTeamMemberDemo(...args: Parameters<StoreModule["addTeamMemberDemo"]>): ReturnType<StoreModule["addTeamMemberDemo"]> {
	return callDemo("addTeamMemberDemo", ...args) as ReturnType<StoreModule["addTeamMemberDemo"]>;
}

export function removeTeamMemberDemo(...args: Parameters<StoreModule["removeTeamMemberDemo"]>): ReturnType<StoreModule["removeTeamMemberDemo"]> {
	return callDemo("removeTeamMemberDemo", ...args) as ReturnType<StoreModule["removeTeamMemberDemo"]>;
}

export function updateTeamMemberRoleDemo(...args: Parameters<StoreModule["updateTeamMemberRoleDemo"]>): ReturnType<StoreModule["updateTeamMemberRoleDemo"]> {
	return callDemo("updateTeamMemberRoleDemo", ...args) as ReturnType<StoreModule["updateTeamMemberRoleDemo"]>;
}

export function updateTeamDemo(...args: Parameters<StoreModule["updateTeamDemo"]>): ReturnType<StoreModule["updateTeamDemo"]> {
	return callDemo("updateTeamDemo", ...args) as ReturnType<StoreModule["updateTeamDemo"]>;
}

export function addSlackUserAsTeamMemberDemo(...args: Parameters<StoreModule["addSlackUserAsTeamMemberDemo"]>): ReturnType<StoreModule["addSlackUserAsTeamMemberDemo"]> {
	return callDemo("addSlackUserAsTeamMemberDemo", ...args) as ReturnType<StoreModule["addSlackUserAsTeamMemberDemo"]>;
}

export function getServicesDemo(...args: Parameters<StoreModule["getServicesDemo"]>): ReturnType<StoreModule["getServicesDemo"]> {
	return callDemo("getServicesDemo", ...args) as ReturnType<StoreModule["getServicesDemo"]>;
}

export function createServiceDemo(...args: Parameters<StoreModule["createServiceDemo"]>): ReturnType<StoreModule["createServiceDemo"]> {
	return callDemo("createServiceDemo", ...args) as ReturnType<StoreModule["createServiceDemo"]>;
}

export function updateServiceDemo(...args: Parameters<StoreModule["updateServiceDemo"]>): ReturnType<StoreModule["updateServiceDemo"]> {
	return callDemo("updateServiceDemo", ...args) as ReturnType<StoreModule["updateServiceDemo"]>;
}

export function deleteServiceDemo(...args: Parameters<StoreModule["deleteServiceDemo"]>): ReturnType<StoreModule["deleteServiceDemo"]> {
	return callDemo("deleteServiceDemo", ...args) as ReturnType<StoreModule["deleteServiceDemo"]>;
}

export function addServiceTeamOwnerDemo(...args: Parameters<StoreModule["addServiceTeamOwnerDemo"]>): ReturnType<StoreModule["addServiceTeamOwnerDemo"]> {
	return callDemo("addServiceTeamOwnerDemo", ...args) as ReturnType<StoreModule["addServiceTeamOwnerDemo"]>;
}

export function removeServiceTeamOwnerDemo(...args: Parameters<StoreModule["removeServiceTeamOwnerDemo"]>): ReturnType<StoreModule["removeServiceTeamOwnerDemo"]> {
	return callDemo("removeServiceTeamOwnerDemo", ...args) as ReturnType<StoreModule["removeServiceTeamOwnerDemo"]>;
}

export function addServiceUserOwnerDemo(...args: Parameters<StoreModule["addServiceUserOwnerDemo"]>): ReturnType<StoreModule["addServiceUserOwnerDemo"]> {
	return callDemo("addServiceUserOwnerDemo", ...args) as ReturnType<StoreModule["addServiceUserOwnerDemo"]>;
}

export function removeServiceUserOwnerDemo(...args: Parameters<StoreModule["removeServiceUserOwnerDemo"]>): ReturnType<StoreModule["removeServiceUserOwnerDemo"]> {
	return callDemo("removeServiceUserOwnerDemo", ...args) as ReturnType<StoreModule["removeServiceUserOwnerDemo"]>;
}

export function addServiceDependencyDemo(...args: Parameters<StoreModule["addServiceDependencyDemo"]>): ReturnType<StoreModule["addServiceDependencyDemo"]> {
	return callDemo("addServiceDependencyDemo", ...args) as ReturnType<StoreModule["addServiceDependencyDemo"]>;
}

export function removeServiceDependencyDemo(...args: Parameters<StoreModule["removeServiceDependencyDemo"]>): ReturnType<StoreModule["removeServiceDependencyDemo"]> {
	return callDemo("removeServiceDependencyDemo", ...args) as ReturnType<StoreModule["removeServiceDependencyDemo"]>;
}

export function getWorkspaceIntegrationsDemo(...args: Parameters<StoreModule["getWorkspaceIntegrationsDemo"]>): ReturnType<StoreModule["getWorkspaceIntegrationsDemo"]> {
	return callDemo("getWorkspaceIntegrationsDemo", ...args) as ReturnType<StoreModule["getWorkspaceIntegrationsDemo"]>;
}

export function getIntercomWorkspaceConfigDemo(...args: Parameters<StoreModule["getIntercomWorkspaceConfigDemo"]>): ReturnType<StoreModule["getIntercomWorkspaceConfigDemo"]> {
	return callDemo("getIntercomWorkspaceConfigDemo", ...args) as ReturnType<StoreModule["getIntercomWorkspaceConfigDemo"]>;
}

export function getUserIntegrationsDemo(...args: Parameters<StoreModule["getUserIntegrationsDemo"]>): ReturnType<StoreModule["getUserIntegrationsDemo"]> {
	return callDemo("getUserIntegrationsDemo", ...args) as ReturnType<StoreModule["getUserIntegrationsDemo"]>;
}

export function connectWorkspaceIntegrationDemo(...args: Parameters<StoreModule["connectWorkspaceIntegrationDemo"]>): ReturnType<StoreModule["connectWorkspaceIntegrationDemo"]> {
	return callDemo("connectWorkspaceIntegrationDemo", ...args) as ReturnType<StoreModule["connectWorkspaceIntegrationDemo"]>;
}

export function connectUserIntegrationDemo(...args: Parameters<StoreModule["connectUserIntegrationDemo"]>): ReturnType<StoreModule["connectUserIntegrationDemo"]> {
	return callDemo("connectUserIntegrationDemo", ...args) as ReturnType<StoreModule["connectUserIntegrationDemo"]>;
}

export function disconnectWorkspaceIntegrationDemo(
	...args: Parameters<StoreModule["disconnectWorkspaceIntegrationDemo"]>
): ReturnType<StoreModule["disconnectWorkspaceIntegrationDemo"]> {
	return callDemo("disconnectWorkspaceIntegrationDemo", ...args) as ReturnType<StoreModule["disconnectWorkspaceIntegrationDemo"]>;
}

export function setIntercomStatusPageDemo(...args: Parameters<StoreModule["setIntercomStatusPageDemo"]>): ReturnType<StoreModule["setIntercomStatusPageDemo"]> {
	return callDemo("setIntercomStatusPageDemo", ...args) as ReturnType<StoreModule["setIntercomStatusPageDemo"]>;
}

export function disconnectUserIntegrationDemo(...args: Parameters<StoreModule["disconnectUserIntegrationDemo"]>): ReturnType<StoreModule["disconnectUserIntegrationDemo"]> {
	return callDemo("disconnectUserIntegrationDemo", ...args) as ReturnType<StoreModule["disconnectUserIntegrationDemo"]>;
}

export function getSlackUsersDemo(...args: Parameters<StoreModule["getSlackUsersDemo"]>): ReturnType<StoreModule["getSlackUsersDemo"]> {
	return callDemo("getSlackUsersDemo", ...args) as ReturnType<StoreModule["getSlackUsersDemo"]>;
}

export function getSlackSelectableChannelsDemo(...args: Parameters<StoreModule["getSlackSelectableChannelsDemo"]>): ReturnType<StoreModule["getSlackSelectableChannelsDemo"]> {
	return callDemo("getSlackSelectableChannelsDemo", ...args) as ReturnType<StoreModule["getSlackSelectableChannelsDemo"]>;
}

export function getSlackBotChannelsDemo(...args: Parameters<StoreModule["getSlackBotChannelsDemo"]>): ReturnType<StoreModule["getSlackBotChannelsDemo"]> {
	return callDemo("getSlackBotChannelsDemo", ...args) as ReturnType<StoreModule["getSlackBotChannelsDemo"]>;
}

export function getSlackEmojisDemo(...args: Parameters<StoreModule["getSlackEmojisDemo"]>): ReturnType<StoreModule["getSlackEmojisDemo"]> {
	return callDemo("getSlackEmojisDemo", ...args) as ReturnType<StoreModule["getSlackEmojisDemo"]>;
}

export function getEntryPointsDemo(...args: Parameters<StoreModule["getEntryPointsDemo"]>): ReturnType<StoreModule["getEntryPointsDemo"]> {
	return callDemo("getEntryPointsDemo", ...args) as ReturnType<StoreModule["getEntryPointsDemo"]>;
}

export function createEntryPointDemo(...args: Parameters<StoreModule["createEntryPointDemo"]>): ReturnType<StoreModule["createEntryPointDemo"]> {
	return callDemo("createEntryPointDemo", ...args) as ReturnType<StoreModule["createEntryPointDemo"]>;
}

export function createEntryPointFromSlackUserDemo(
	...args: Parameters<StoreModule["createEntryPointFromSlackUserDemo"]>
): ReturnType<StoreModule["createEntryPointFromSlackUserDemo"]> {
	return callDemo("createEntryPointFromSlackUserDemo", ...args) as ReturnType<StoreModule["createEntryPointFromSlackUserDemo"]>;
}

export function deleteEntryPointDemo(...args: Parameters<StoreModule["deleteEntryPointDemo"]>): ReturnType<StoreModule["deleteEntryPointDemo"]> {
	return callDemo("deleteEntryPointDemo", ...args) as ReturnType<StoreModule["deleteEntryPointDemo"]>;
}

export function updateEntryPointPromptDemo(...args: Parameters<StoreModule["updateEntryPointPromptDemo"]>): ReturnType<StoreModule["updateEntryPointPromptDemo"]> {
	return callDemo("updateEntryPointPromptDemo", ...args) as ReturnType<StoreModule["updateEntryPointPromptDemo"]>;
}

export function setFallbackEntryPointDemo(...args: Parameters<StoreModule["setFallbackEntryPointDemo"]>): ReturnType<StoreModule["setFallbackEntryPointDemo"]> {
	return callDemo("setFallbackEntryPointDemo", ...args) as ReturnType<StoreModule["setFallbackEntryPointDemo"]>;
}

export function getRotationsDemo(...args: Parameters<StoreModule["getRotationsDemo"]>): ReturnType<StoreModule["getRotationsDemo"]> {
	return callDemo("getRotationsDemo", ...args) as ReturnType<StoreModule["getRotationsDemo"]>;
}

export function createRotationDemo(...args: Parameters<StoreModule["createRotationDemo"]>): ReturnType<StoreModule["createRotationDemo"]> {
	return callDemo("createRotationDemo", ...args) as ReturnType<StoreModule["createRotationDemo"]>;
}

export function deleteRotationDemo(...args: Parameters<StoreModule["deleteRotationDemo"]>): ReturnType<StoreModule["deleteRotationDemo"]> {
	return callDemo("deleteRotationDemo", ...args) as ReturnType<StoreModule["deleteRotationDemo"]>;
}

export function updateRotationNameDemo(...args: Parameters<StoreModule["updateRotationNameDemo"]>): ReturnType<StoreModule["updateRotationNameDemo"]> {
	return callDemo("updateRotationNameDemo", ...args) as ReturnType<StoreModule["updateRotationNameDemo"]>;
}

export function updateRotationTeamDemo(...args: Parameters<StoreModule["updateRotationTeamDemo"]>): ReturnType<StoreModule["updateRotationTeamDemo"]> {
	return callDemo("updateRotationTeamDemo", ...args) as ReturnType<StoreModule["updateRotationTeamDemo"]>;
}

export function updateRotationSlackChannelDemo(...args: Parameters<StoreModule["updateRotationSlackChannelDemo"]>): ReturnType<StoreModule["updateRotationSlackChannelDemo"]> {
	return callDemo("updateRotationSlackChannelDemo", ...args) as ReturnType<StoreModule["updateRotationSlackChannelDemo"]>;
}

export function updateRotationShiftLengthDemo(...args: Parameters<StoreModule["updateRotationShiftLengthDemo"]>): ReturnType<StoreModule["updateRotationShiftLengthDemo"]> {
	return callDemo("updateRotationShiftLengthDemo", ...args) as ReturnType<StoreModule["updateRotationShiftLengthDemo"]>;
}

export function addRotationAssigneeDemo(...args: Parameters<StoreModule["addRotationAssigneeDemo"]>): ReturnType<StoreModule["addRotationAssigneeDemo"]> {
	return callDemo("addRotationAssigneeDemo", ...args) as ReturnType<StoreModule["addRotationAssigneeDemo"]>;
}

export function addSlackUserAsRotationAssigneeDemo(
	...args: Parameters<StoreModule["addSlackUserAsRotationAssigneeDemo"]>
): ReturnType<StoreModule["addSlackUserAsRotationAssigneeDemo"]> {
	return callDemo("addSlackUserAsRotationAssigneeDemo", ...args) as ReturnType<StoreModule["addSlackUserAsRotationAssigneeDemo"]>;
}

export function reorderRotationAssigneeDemo(...args: Parameters<StoreModule["reorderRotationAssigneeDemo"]>): ReturnType<StoreModule["reorderRotationAssigneeDemo"]> {
	return callDemo("reorderRotationAssigneeDemo", ...args) as ReturnType<StoreModule["reorderRotationAssigneeDemo"]>;
}

export function removeRotationAssigneeDemo(...args: Parameters<StoreModule["removeRotationAssigneeDemo"]>): ReturnType<StoreModule["removeRotationAssigneeDemo"]> {
	return callDemo("removeRotationAssigneeDemo", ...args) as ReturnType<StoreModule["removeRotationAssigneeDemo"]>;
}

export function getRotationOverridesDemo(...args: Parameters<StoreModule["getRotationOverridesDemo"]>): ReturnType<StoreModule["getRotationOverridesDemo"]> {
	return callDemo("getRotationOverridesDemo", ...args) as ReturnType<StoreModule["getRotationOverridesDemo"]>;
}

export function createRotationOverrideDemo(...args: Parameters<StoreModule["createRotationOverrideDemo"]>): ReturnType<StoreModule["createRotationOverrideDemo"]> {
	return callDemo("createRotationOverrideDemo", ...args) as ReturnType<StoreModule["createRotationOverrideDemo"]>;
}

export function setRotationOverrideDemo(...args: Parameters<StoreModule["setRotationOverrideDemo"]>): ReturnType<StoreModule["setRotationOverrideDemo"]> {
	return callDemo("setRotationOverrideDemo", ...args) as ReturnType<StoreModule["setRotationOverrideDemo"]>;
}

export function clearRotationOverrideDemo(...args: Parameters<StoreModule["clearRotationOverrideDemo"]>): ReturnType<StoreModule["clearRotationOverrideDemo"]> {
	return callDemo("clearRotationOverrideDemo", ...args) as ReturnType<StoreModule["clearRotationOverrideDemo"]>;
}

export function updateRotationOverrideDemo(...args: Parameters<StoreModule["updateRotationOverrideDemo"]>): ReturnType<StoreModule["updateRotationOverrideDemo"]> {
	return callDemo("updateRotationOverrideDemo", ...args) as ReturnType<StoreModule["updateRotationOverrideDemo"]>;
}

export function updateRotationAnchorDemo(...args: Parameters<StoreModule["updateRotationAnchorDemo"]>): ReturnType<StoreModule["updateRotationAnchorDemo"]> {
	return callDemo("updateRotationAnchorDemo", ...args) as ReturnType<StoreModule["updateRotationAnchorDemo"]>;
}

export function getStatusPagesDemo(...args: Parameters<StoreModule["getStatusPagesDemo"]>): ReturnType<StoreModule["getStatusPagesDemo"]> {
	return callDemo("getStatusPagesDemo", ...args) as ReturnType<StoreModule["getStatusPagesDemo"]>;
}

export function createStatusPageDemo(...args: Parameters<StoreModule["createStatusPageDemo"]>): ReturnType<StoreModule["createStatusPageDemo"]> {
	return callDemo("createStatusPageDemo", ...args) as ReturnType<StoreModule["createStatusPageDemo"]>;
}

export function updateStatusPageDemo(...args: Parameters<StoreModule["updateStatusPageDemo"]>): ReturnType<StoreModule["updateStatusPageDemo"]> {
	return callDemo("updateStatusPageDemo", ...args) as ReturnType<StoreModule["updateStatusPageDemo"]>;
}

export function deleteStatusPageDemo(...args: Parameters<StoreModule["deleteStatusPageDemo"]>): ReturnType<StoreModule["deleteStatusPageDemo"]> {
	return callDemo("deleteStatusPageDemo", ...args) as ReturnType<StoreModule["deleteStatusPageDemo"]>;
}

export function updateStatusPageServicesDemo(...args: Parameters<StoreModule["updateStatusPageServicesDemo"]>): ReturnType<StoreModule["updateStatusPageServicesDemo"]> {
	return callDemo("updateStatusPageServicesDemo", ...args) as ReturnType<StoreModule["updateStatusPageServicesDemo"]>;
}

export function updateStatusPageServiceDescriptionDemo(
	...args: Parameters<StoreModule["updateStatusPageServiceDescriptionDemo"]>
): ReturnType<StoreModule["updateStatusPageServiceDescriptionDemo"]> {
	return callDemo("updateStatusPageServiceDescriptionDemo", ...args) as ReturnType<StoreModule["updateStatusPageServiceDescriptionDemo"]>;
}

export function verifyCustomDomainDemo(...args: Parameters<StoreModule["verifyCustomDomainDemo"]>): ReturnType<StoreModule["verifyCustomDomainDemo"]> {
	return callDemo("verifyCustomDomainDemo", ...args) as ReturnType<StoreModule["verifyCustomDomainDemo"]>;
}

export function getApiKeysDemo(...args: Parameters<StoreModule["getApiKeysDemo"]>): ReturnType<StoreModule["getApiKeysDemo"]> {
	return callDemo("getApiKeysDemo", ...args) as ReturnType<StoreModule["getApiKeysDemo"]>;
}

export function createApiKeyDemo(...args: Parameters<StoreModule["createApiKeyDemo"]>): ReturnType<StoreModule["createApiKeyDemo"]> {
	return callDemo("createApiKeyDemo", ...args) as ReturnType<StoreModule["createApiKeyDemo"]>;
}

export function revokeApiKeyDemo(...args: Parameters<StoreModule["revokeApiKeyDemo"]>): ReturnType<StoreModule["revokeApiKeyDemo"]> {
	return callDemo("revokeApiKeyDemo", ...args) as ReturnType<StoreModule["revokeApiKeyDemo"]>;
}

export function startIncidentDemo(...args: Parameters<StoreModule["startIncidentDemo"]>): ReturnType<StoreModule["startIncidentDemo"]> {
	return callDemo("startIncidentDemo", ...args) as ReturnType<StoreModule["startIncidentDemo"]>;
}

export function getIncidentsDemo(...args: Parameters<StoreModule["getIncidentsDemo"]>): ReturnType<StoreModule["getIncidentsDemo"]> {
	return callDemo("getIncidentsDemo", ...args) as ReturnType<StoreModule["getIncidentsDemo"]>;
}

export function getIncidentByIdDemo(...args: Parameters<StoreModule["getIncidentByIdDemo"]>): ReturnType<StoreModule["getIncidentByIdDemo"]> {
	return callDemo("getIncidentByIdDemo", ...args) as ReturnType<StoreModule["getIncidentByIdDemo"]>;
}

export function updateAssigneeDemo(...args: Parameters<StoreModule["updateAssigneeDemo"]>): ReturnType<StoreModule["updateAssigneeDemo"]> {
	return callDemo("updateAssigneeDemo", ...args) as ReturnType<StoreModule["updateAssigneeDemo"]>;
}

export function updateSeverityDemo(...args: Parameters<StoreModule["updateSeverityDemo"]>): ReturnType<StoreModule["updateSeverityDemo"]> {
	return callDemo("updateSeverityDemo", ...args) as ReturnType<StoreModule["updateSeverityDemo"]>;
}

export function updateStatusDemo(...args: Parameters<StoreModule["updateStatusDemo"]>): ReturnType<StoreModule["updateStatusDemo"]> {
	return callDemo("updateStatusDemo", ...args) as ReturnType<StoreModule["updateStatusDemo"]>;
}

export function sendSlackMessageDemo(...args: Parameters<StoreModule["sendSlackMessageDemo"]>): ReturnType<StoreModule["sendSlackMessageDemo"]> {
	return callDemo("sendSlackMessageDemo", ...args) as ReturnType<StoreModule["sendSlackMessageDemo"]>;
}

export function getResolvedIncidentsDemo(...args: Parameters<StoreModule["getResolvedIncidentsDemo"]>): ReturnType<StoreModule["getResolvedIncidentsDemo"]> {
	return callDemo("getResolvedIncidentsDemo", ...args) as ReturnType<StoreModule["getResolvedIncidentsDemo"]>;
}

export function getAnalysisByIdDemo(...args: Parameters<StoreModule["getAnalysisByIdDemo"]>): ReturnType<StoreModule["getAnalysisByIdDemo"]> {
	return callDemo("getAnalysisByIdDemo", ...args) as ReturnType<StoreModule["getAnalysisByIdDemo"]>;
}

export function getMetricsDemo(...args: Parameters<StoreModule["getMetricsDemo"]>): ReturnType<StoreModule["getMetricsDemo"]> {
	return callDemo("getMetricsDemo", ...args) as ReturnType<StoreModule["getMetricsDemo"]>;
}

export function updateAnalysisImpactDemo(...args: Parameters<StoreModule["updateAnalysisImpactDemo"]>): ReturnType<StoreModule["updateAnalysisImpactDemo"]> {
	return callDemo("updateAnalysisImpactDemo", ...args) as ReturnType<StoreModule["updateAnalysisImpactDemo"]>;
}

export function updateAnalysisRootCauseDemo(...args: Parameters<StoreModule["updateAnalysisRootCauseDemo"]>): ReturnType<StoreModule["updateAnalysisRootCauseDemo"]> {
	return callDemo("updateAnalysisRootCauseDemo", ...args) as ReturnType<StoreModule["updateAnalysisRootCauseDemo"]>;
}

export function updateAnalysisTimelineDemo(...args: Parameters<StoreModule["updateAnalysisTimelineDemo"]>): ReturnType<StoreModule["updateAnalysisTimelineDemo"]> {
	return callDemo("updateAnalysisTimelineDemo", ...args) as ReturnType<StoreModule["updateAnalysisTimelineDemo"]>;
}

export function updateIncidentActionDemo(...args: Parameters<StoreModule["updateIncidentActionDemo"]>): ReturnType<StoreModule["updateIncidentActionDemo"]> {
	return callDemo("updateIncidentActionDemo", ...args) as ReturnType<StoreModule["updateIncidentActionDemo"]>;
}

export function deleteIncidentActionDemo(...args: Parameters<StoreModule["deleteIncidentActionDemo"]>): ReturnType<StoreModule["deleteIncidentActionDemo"]> {
	return callDemo("deleteIncidentActionDemo", ...args) as ReturnType<StoreModule["deleteIncidentActionDemo"]>;
}

export function createIncidentActionDemo(...args: Parameters<StoreModule["createIncidentActionDemo"]>): ReturnType<StoreModule["createIncidentActionDemo"]> {
	return callDemo("createIncidentActionDemo", ...args) as ReturnType<StoreModule["createIncidentActionDemo"]>;
}

export function getIncidentAffectionDemo(...args: Parameters<StoreModule["getIncidentAffectionDemo"]>): ReturnType<StoreModule["getIncidentAffectionDemo"]> {
	return callDemo("getIncidentAffectionDemo", ...args) as ReturnType<StoreModule["getIncidentAffectionDemo"]>;
}

export function createIncidentAffectionDemo(...args: Parameters<StoreModule["createIncidentAffectionDemo"]>): ReturnType<StoreModule["createIncidentAffectionDemo"]> {
	return callDemo("createIncidentAffectionDemo", ...args) as ReturnType<StoreModule["createIncidentAffectionDemo"]>;
}

export function addIncidentAffectionUpdateDemo(...args: Parameters<StoreModule["addIncidentAffectionUpdateDemo"]>): ReturnType<StoreModule["addIncidentAffectionUpdateDemo"]> {
	return callDemo("addIncidentAffectionUpdateDemo", ...args) as ReturnType<StoreModule["addIncidentAffectionUpdateDemo"]>;
}

export function updateIncidentAffectionServicesDemo(
	...args: Parameters<StoreModule["updateIncidentAffectionServicesDemo"]>
): ReturnType<StoreModule["updateIncidentAffectionServicesDemo"]> {
	return callDemo("updateIncidentAffectionServicesDemo", ...args) as ReturnType<StoreModule["updateIncidentAffectionServicesDemo"]>;
}

export function getNotionPagesDemo(...args: Parameters<StoreModule["getNotionPagesDemo"]>): ReturnType<StoreModule["getNotionPagesDemo"]> {
	return callDemo("getNotionPagesDemo", ...args) as ReturnType<StoreModule["getNotionPagesDemo"]>;
}

export function exportToNotionDemo(...args: Parameters<StoreModule["exportToNotionDemo"]>): ReturnType<StoreModule["exportToNotionDemo"]> {
	return callDemo("exportToNotionDemo", ...args) as ReturnType<StoreModule["exportToNotionDemo"]>;
}
