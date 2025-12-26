import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { client, user } from "./auth";

/**
 * API keys for programmatic access to the API.
 * Keys are hashed before storage - the plain key is only shown once on creation.
 */
export const apiKey = pgTable("api_key", {
	id: text("id").primaryKey(),
	clientId: text("client_id")
		.notNull()
		.references(() => client.id, { onDelete: "cascade" }),
	name: text("name").notNull(),
	keyHash: text("key_hash").notNull(),
	keyPrefix: text("key_prefix").notNull(), // First 8 chars for identification
	createdBy: text("created_by")
		.notNull()
		.references(() => user.id),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});
