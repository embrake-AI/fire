import { client } from "@fire/db/schema";
import { createServerFn } from "@tanstack/solid-start";
import { eq } from "drizzle-orm";
import { authMiddleware } from "../auth/auth-middleware";
import { db } from "../db";

export const getClient = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(async ({ context }) => {
		const [clientRecord] = await db.select({ name: client.name, domains: client.domains }).from(client).where(eq(client.id, context.clientId));
		if (!clientRecord) {
			throw new Error("Unreachable");
		}
		return clientRecord ?? { name: "", domains: [] as string[] };
	});
