import { client, user } from "@fire/db/schema";
import { createServerFn } from "@tanstack/solid-start";
import { asc, eq } from "drizzle-orm";
import { db } from "../db";
import { createUserFacingError } from "../errors/user-facing-error";
import { authMiddleware } from "./auth-middleware";
import { requirePermission } from "./authorization";

export const getSuperAdminClients = createServerFn({ method: "GET" })
	.middleware([authMiddleware, requirePermission("impersonation.write")])
	.handler(async () => {
		return db
			.select({
				id: client.id,
				name: client.name,
				image: client.image,
				domains: client.domains,
			})
			.from(client)
			.orderBy(asc(client.name));
	});

export const getSuperAdminClientUsers = createServerFn({ method: "POST" })
	.middleware([authMiddleware, requirePermission("impersonation.write")])
	.inputValidator((data: { clientId: string }) => data)
	.handler(async ({ data }) => {
		const clientId = data.clientId.trim();
		if (!clientId) {
			throw createUserFacingError("Please select a client.");
		}

		const [workspaceClient] = await db
			.select({
				id: client.id,
			})
			.from(client)
			.where(eq(client.id, clientId))
			.limit(1);

		if (!workspaceClient) {
			throw createUserFacingError("Client not found.");
		}

		return db
			.select({
				id: user.id,
				name: user.name,
				email: user.email,
				image: user.image,
				role: user.role,
			})
			.from(user)
			.where(eq(user.clientId, clientId))
			.orderBy(asc(user.name));
	});
