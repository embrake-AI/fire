import { index, pgEnum, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { service } from "./service";

export const affectionStatus = pgEnum("affection_status", ["investigating", "mitigating", "resolved"]);

export const incidentAffection = pgTable(
	"incident_affection",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		// An incident might live only in incidentd, that's why no FK
		incidentId: text("incident_id").notNull(),
		title: text("title").notNull(),
		createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		resolvedAt: timestamp("resolved_at", { withTimezone: true }),
	},
	(table) => [index("incident_affection_incident_idx").on(table.incidentId)],
);

export const affectionImpact = pgEnum("affection_impact", ["partial", "major"]);

export const incidentAffectionService = pgTable(
	"incident_affection_service",
	{
		affectionId: uuid("affection_id")
			.notNull()
			.references(() => incidentAffection.id, { onDelete: "cascade" }),
		serviceId: uuid("service_id")
			.notNull()
			.references(() => service.id, { onDelete: "cascade" }),
		impact: affectionImpact("impact").notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.affectionId, table.serviceId] }),
		index("incident_affection_service_affection_idx").on(table.affectionId),
		index("incident_affection_service_service_idx").on(table.serviceId),
	],
);

export const incidentAffectionUpdate = pgTable(
	"incident_affection_update",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		affectionId: uuid("affection_id")
			.notNull()
			.references(() => incidentAffection.id, { onDelete: "cascade" }),
		status: affectionStatus("status"),
		message: text("message"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
	},
	(table) => [index("incident_affection_update_affection_idx").on(table.affectionId)],
);
