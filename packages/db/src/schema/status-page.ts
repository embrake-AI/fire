import { index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { client } from "./auth";
import { service } from "./service";

export const statusPage = pgTable(
	"status_page",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		clientId: text("client_id")
			.notNull()
			.references(() => client.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		slug: text("slug").notNull(),
		logoUrl: text("logo_url"),
		faviconUrl: text("favicon_url"),
		serviceDisplayMode: text("service_display_mode").default("bars_percentage"),
		customDomain: text("custom_domain"),
		supportUrl: text("support_url"),
		privacyPolicyUrl: text("privacy_policy_url"),
		termsOfServiceUrl: text("terms_of_service_url"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [uniqueIndex("status_page_slug_idx").on(table.slug)],
);

export const statusPageService = pgTable(
	"status_page_service",
	{
		statusPageId: uuid("status_page_id")
			.notNull()
			.references(() => statusPage.id, { onDelete: "cascade" }),
		serviceId: uuid("service_id")
			.notNull()
			.references(() => service.id, { onDelete: "cascade" }),
		position: integer("position"),
		description: text("description"),
	},
	(table) => [
		primaryKey({ columns: [table.statusPageId, table.serviceId] }),
		index("status_page_service_page_idx").on(table.statusPageId),
		index("status_page_service_service_idx").on(table.serviceId),
	],
);
