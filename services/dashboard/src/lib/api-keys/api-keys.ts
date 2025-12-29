import { apiKey } from "@fire/db/schema";
import { createServerFn } from "@tanstack/solid-start";
import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { authMiddleware } from "../auth/auth-middleware";
import { db } from "../db";
import { sha256 } from "../utils/server";

function generateApiKey(): string {
	const key = nanoid(32);
	return `fire_${key}`;
}

export const getApiKeys = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(async ({ context }) => {
		const keys = await db
			.select({
				id: apiKey.id,
				name: apiKey.name,
				keyPrefix: apiKey.keyPrefix,
				createdAt: apiKey.createdAt,
				lastUsedAt: apiKey.lastUsedAt,
			})
			.from(apiKey)
			.where(eq(apiKey.clientId, context.clientId))
			.orderBy(desc(apiKey.createdAt));

		return keys;
	});

export const createApiKey = createServerFn({ method: "POST" })
	.inputValidator((data: { name: string }) => data)
	.middleware([authMiddleware])
	.handler(async ({ data, context }) => {
		const plainKey = generateApiKey();
		const keyHash = await sha256(plainKey);
		const keyPrefix = plainKey.slice(0, 12);

		const id = nanoid();

		await db.insert(apiKey).values({
			id,
			clientId: context.clientId,
			name: data.name,
			keyHash,
			keyPrefix,
			createdBy: context.userId,
		});

		return {
			id,
			name: data.name,
			key: plainKey,
			keyPrefix,
		};
	});

export const revokeApiKey = createServerFn({ method: "POST" })
	.inputValidator((data: { id: string }) => data)
	.middleware([authMiddleware])
	.handler(async ({ data, context }) => {
		await db.delete(apiKey).where(and(eq(apiKey.id, data.id), eq(apiKey.clientId, context.clientId)));
		return { success: true };
	});
