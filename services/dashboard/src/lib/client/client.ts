import { client } from "@fire/db/schema";
import { createServerFn } from "@tanstack/solid-start";
import { eq } from "drizzle-orm";
import { authMiddleware } from "../auth/auth-middleware";
import { requirePermission } from "../auth/authorization";
import { db } from "../db";

export const getClient = createServerFn({ method: "GET" })
	.middleware([authMiddleware, requirePermission("catalog.read")])
	.handler(async ({ context }) => {
		const [clientRecord] = await db.select({ name: client.name, image: client.image, domains: client.domains }).from(client).where(eq(client.id, context.clientId));
		if (!clientRecord) {
			throw new Error("Unreachable");
		}
		return clientRecord ?? { name: "", image: null as string | null, domains: [] as string[] };
	});

export const updateClient = createServerFn({ method: "POST" })
	.middleware([authMiddleware, requirePermission("settings.workspace.write")])
	.inputValidator((data: { name?: string; image?: string | null }) => data)
	.handler(async ({ context, data }) => {
		const [updated] = await db
			.update(client)
			.set({
				...(!!data.name && { name: data.name }),
				...(!!data.image && { image: data.image }),
				updatedAt: new Date(),
			})
			.where(eq(client.id, context.clientId))
			.returning({ name: client.name, image: client.image });
		return updated;
	});
