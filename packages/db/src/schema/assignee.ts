import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const assigneeType = pgEnum("assignee_type", [
	"slack-user",
	"slack-user-group",
]);

export const assignee = pgTable("assignee", {
	id: uuid("id").primaryKey().defaultRandom(),
	type: assigneeType("type").notNull(),
	identifier: text("identifier").notNull(),
	prompt: text("prompt").notNull(),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
