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
}));
