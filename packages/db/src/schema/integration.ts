import { jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { client, user } from "./auth";

export const platformType = pgEnum("platform_type", ["slack"]);

/**
 * Slack-specific integration data stored in the JSONB `data` column.
 */
export type SlackIntegrationData = {
	teamId: string;
	teamName: string;
	enterpriseId: string | null;
	appId: string;
	botUserId: string;
	botToken: string;
	botScopes: string[];
};

/**
 * Integration table for storing platform connections per client.
 * Each client can have one integration per platform (e.g., one Slack workspace).
 */
export const integration = pgTable(
	"integration",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		clientId: text("client_id")
			.notNull()
			.references(() => client.id, { onDelete: "cascade" }),
		createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
		platform: platformType("platform").notNull(),
		data: jsonb("data").$type<SlackIntegrationData>().notNull(),
		installedAt: timestamp("installed_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [uniqueIndex("integration_client_platform_idx").on(table.clientId, table.platform)],
);
