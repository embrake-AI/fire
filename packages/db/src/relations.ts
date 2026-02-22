import { defineRelations } from "drizzle-orm";
import * as schema from "./schema";

export const relations = defineRelations(schema, (r) => ({
	client: {
		billing: r.one.clientBilling({
			from: r.client.id,
			to: r.clientBilling.clientId,
		}),
		integrations: r.many.integration({
			from: r.client.id,
			to: r.integration.clientId,
		}),
		entryPoints: r.many.entryPoint({
			from: r.client.id,
			to: r.entryPoint.clientId,
		}),
		apiKeys: r.many.apiKey({
			from: r.client.id,
			to: r.apiKey.clientId,
		}),
		teams: r.many.team({
			from: r.client.id,
			to: r.team.clientId,
		}),
		services: r.many.service({
			from: r.client.id,
			to: r.service.clientId,
		}),
		statusPages: r.many.statusPage({
			from: r.client.id,
			to: r.statusPage.clientId,
		}),
	},
	clientBilling: {
		client: r.one.client({
			from: r.clientBilling.clientId,
			to: r.client.id,
		}),
	},
	team: {
		members: r.many.user({
			from: r.team.id.through(r.teamMember.teamId),
			to: r.user.id.through(r.teamMember.userId),
		}),
		rotations: r.many.rotation({
			from: r.team.id,
			to: r.rotation.teamId,
		}),
		servicesOwned: r.many.service({
			from: r.team.id.through(r.serviceTeamOwner.teamId),
			to: r.service.id.through(r.serviceTeamOwner.serviceId),
		}),
	},
	service: {
		teamOwners: r.many.team({
			from: r.service.id.through(r.serviceTeamOwner.serviceId),
			to: r.team.id.through(r.serviceTeamOwner.teamId),
		}),
		userOwners: r.many.user({
			from: r.service.id.through(r.serviceUserOwner.serviceId),
			to: r.user.id.through(r.serviceUserOwner.userId),
		}),
		affectsServices: r.many.service({
			from: r.service.id.through(r.serviceDependency.baseServiceId),
			to: r.service.id.through(r.serviceDependency.affectedServiceId),
		}),
		affectedByServices: r.many.service({
			from: r.service.id.through(r.serviceDependency.affectedServiceId),
			to: r.service.id.through(r.serviceDependency.baseServiceId),
		}),
		statusPages: r.many.statusPage({
			from: r.service.id.through(r.statusPageService.serviceId),
			to: r.statusPage.id.through(r.statusPageService.statusPageId),
		}),
		incidentAffections: r.many.incidentAffection({
			from: r.service.id.through(r.incidentAffectionService.serviceId),
			to: r.incidentAffection.id.through(r.incidentAffectionService.affectionId),
		}),
	},
	statusPage: {
		services: r.many.service({
			from: r.statusPage.id.through(r.statusPageService.statusPageId),
			to: r.service.id.through(r.statusPageService.serviceId),
		}),
		serviceLinks: r.many.statusPageService({
			from: r.statusPage.id,
			to: r.statusPageService.statusPageId,
		}),
	},
	statusPageService: {
		statusPage: r.one.statusPage({
			from: r.statusPageService.statusPageId,
			to: r.statusPage.id,
		}),
		service: r.one.service({
			from: r.statusPageService.serviceId,
			to: r.service.id,
		}),
	},
	incidentAffection: {
		services: r.many.service({
			from: r.incidentAffection.id.through(r.incidentAffectionService.affectionId),
			to: r.service.id.through(r.incidentAffectionService.serviceId),
		}),
		updates: r.many.incidentAffectionUpdate({
			from: r.incidentAffection.id,
			to: r.incidentAffectionUpdate.affectionId,
		}),
	},
	incidentAffectionService: {
		affection: r.one.incidentAffection({
			from: r.incidentAffectionService.affectionId,
			to: r.incidentAffection.id,
		}),
		service: r.one.service({
			from: r.incidentAffectionService.serviceId,
			to: r.service.id,
		}),
	},
	incidentAffectionUpdate: {
		affection: r.one.incidentAffection({
			from: r.incidentAffectionUpdate.affectionId,
			to: r.incidentAffection.id,
		}),
	},
	incidentAnalysis: {
		actions: r.many.incidentAction({
			from: r.incidentAnalysis.id,
			to: r.incidentAction.incidentId,
		}),
	},
	incidentAction: {
		incident: r.one.incidentAnalysis({
			from: r.incidentAction.incidentId,
			to: r.incidentAnalysis.id,
		}),
	},
	serviceDependency: {
		baseService: r.one.service({
			from: r.serviceDependency.baseServiceId,
			to: r.service.id,
		}),
		affectedService: r.one.service({
			from: r.serviceDependency.affectedServiceId,
			to: r.service.id,
		}),
	},
	rotation: {
		rotationWithAssignee: r.one.rotationWithAssignee({
			from: r.rotation.id,
			to: r.rotationWithAssignee.id,
		}),
		members: r.many.rotationMember({
			from: r.rotation.id,
			to: r.rotationMember.rotationId,
		}),
		overrides: r.many.rotationOverride({
			from: r.rotation.id,
			to: r.rotationOverride.rotationId,
		}),
		team: r.one.team({
			from: r.rotation.teamId,
			to: r.team.id,
		}),
	},
	rotationMember: {
		rotation: r.one.rotation({
			from: r.rotationMember.rotationId,
			to: r.rotation.id,
		}),
		assignee: r.one.user({
			from: r.rotationMember.assigneeId,
			to: r.user.id,
		}),
	},
	rotationOverride: {
		rotation: r.one.rotation({
			from: r.rotationOverride.rotationId,
			to: r.rotation.id,
		}),
		assignee: r.one.user({
			from: r.rotationOverride.assigneeId,
			to: r.user.id,
		}),
	},
	entryPoint: {
		rotationWithAssignee: r.one.rotationWithAssignee({
			from: r.entryPoint.rotationId,
			to: r.rotationWithAssignee.id,
		}),
		rotation: r.one.rotation({
			from: r.entryPoint.rotationId,
			to: r.rotation.id,
		}),
		assignee: r.one.user({
			from: r.entryPoint.assigneeId,
			to: r.user.id,
		}),
	},
	rotationWithAssignee: {
		assignee: r.one.user({
			from: r.rotationWithAssignee.effectiveAssignee,
			to: r.user.id,
		}),
	},
	user: {
		teamMember: r.many.teamMember({
			from: r.user.id,
			to: r.teamMember.userId,
		}),
		teams: r.many.team({
			from: r.user.id.through(r.teamMember.userId),
			to: r.team.id.through(r.teamMember.teamId),
		}),
		servicesOwned: r.many.service({
			from: r.user.id.through(r.serviceUserOwner.userId),
			to: r.service.id.through(r.serviceUserOwner.serviceId),
		}),
		userIntegrations: r.many.userIntegration({
			from: r.user.id,
			to: r.userIntegration.userId,
		}),
	},
}));
