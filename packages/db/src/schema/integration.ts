import { jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { client, user } from "./auth";

export const platformType = pgEnum("platform_type", ["slack", "notion"]);

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
 * Notion-specific integration data stored in the JSONB `data` column.
 */
export type NotionIntegrationData = {
	workspaceId: string;
	workspaceName: string | null;
	workspaceIcon: string | null;
	accessToken: string;
	botId: string;
};

/**
 * Union type for all supported platform integration data.
 */
export type IntegrationData = SlackIntegrationData | NotionIntegrationData;

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
		data: jsonb("data").$type<IntegrationData>().notNull(),
		installedAt: timestamp("installed_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [uniqueIndex("integration_client_platform_idx").on(table.clientId, table.platform)],
);

export type UserSlackIntegrationData = Omit<SlackIntegrationData, "botUserId" | "botToken" | "botScopes"> & {
	userId: string;
	userToken: string;
	userScopes: string[];
};

export const userIntegration = pgTable(
	"user_integration",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
		platform: platformType("platform").notNull(),
		data: jsonb("data").$type<UserSlackIntegrationData>().notNull(),
		installedAt: timestamp("installed_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
	},
	(table) => [uniqueIndex("user_integration_user_platform_idx").on(table.userId, table.platform)],
);
