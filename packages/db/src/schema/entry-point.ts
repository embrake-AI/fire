import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const assigneeType = pgEnum("assignee_type", ["slack-user", "slack-user-group"]);

export const entryPoint = pgTable("entry_point", {
	id: uuid("id").primaryKey().defaultRandom(),
	type: assigneeType("type").notNull(),
	assigneeId: text("assignee_id").notNull(),
	prompt: text("prompt").notNull(),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
