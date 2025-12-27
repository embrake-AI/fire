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
	},
	rotation: {
		rotationWithAssignee: r.one.rotationWithAssignee({
			from: r.rotation.id,
			to: r.rotationWithAssignee.id,
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
	},
}));
