import type { IS_Event } from "@fire/common";
import { jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { client } from "./auth";
import { entryPoint } from "./entry-point";
import { rotation } from "./rotation";
import { team } from "./team";

export const incidentSeverity = pgEnum("incident_severity", ["low", "medium", "high"]);
export const incidentSource = pgEnum("incident_source", ["slack", "dashboard"]);

/**
 * Event stored in the events JSONB array.
 */
export type IncidentEventData = IS_Event & {
	id: number;
	adapter: "slack" | "dashboard";
	created_at: string;
};

/**
 * Incident analysis table for storing resolved incidents with their event history and AI summary.
 * This is the permanent record after a Durable Object is destroyed.
 */
export const incidentAnalysis = pgTable("incident_analysis", {
	id: text("id").primaryKey(),
	clientId: text("client_id")
		.notNull()
		.references(() => client.id, { onDelete: "cascade" }),
	title: text("title").notNull(),
	description: text("description").notNull(),
	severity: incidentSeverity("severity").notNull(),
	assignee: text("assignee").notNull(),
	createdBy: text("created_by").notNull(),
	source: incidentSource("source").notNull(),
	prompt: text("prompt").notNull(),
	summary: text("summary").notNull(),
	events: jsonb("events").$type<IncidentEventData[]>().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
	resolvedAt: timestamp("resolved_at", { withTimezone: true }).defaultNow().notNull(),
	entryPointId: uuid("entry_point_id").references(() => entryPoint.id, { onDelete: "set null" }),
	rotationId: uuid("rotation_id").references(() => rotation.id, { onDelete: "set null" }),
	teamId: uuid("team_id").references(() => team.id, { onDelete: "set null" }),
});
