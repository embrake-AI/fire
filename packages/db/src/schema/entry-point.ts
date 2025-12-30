import { boolean, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { client, user } from "./auth";
import { rotation } from "./rotation";

export const assigneeType = pgEnum("assignee_type", ["user", "rotation"]);

export const entryPoint = pgTable("entry_point", {
	id: uuid("id").primaryKey().defaultRandom(),
	type: assigneeType("type").notNull(),
	assigneeId: text("assignee_id").references(() => user.id, { onDelete: "cascade" }), // nullable, used for user
	rotationId: uuid("rotation_id").references(() => rotation.id, { onDelete: "cascade" }), // nullable, used for rotation
	prompt: text("prompt").notNull(),
	isFallback: boolean("is_fallback").notNull().default(false),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
	clientId: text("client_id")
		.notNull()
		.references(() => client.id, { onDelete: "cascade" }),
});
