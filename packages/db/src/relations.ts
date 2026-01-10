import { defineRelations } from "drizzle-orm";
import * as schema from "./schema";

export const relations = defineRelations(schema, (r) => ({
	client: {
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
		teams: r.many.team({
			from: r.user.id.through(r.teamMember.userId),
			to: r.team.id.through(r.teamMember.teamId),
		}),
		userIntegrations: r.many.userIntegration({
			from: r.user.id,
			to: r.userIntegration.userId,
		}),
	},
}));
