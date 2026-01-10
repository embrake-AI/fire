import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { rotation } from "./rotation";

export const rotationMember = pgTable(
	"rotation_member",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		rotationId: uuid("rotation_id")
			.notNull()
			.references(() => rotation.id, { onDelete: "cascade" }),
		assigneeId: text("assignee_id")
			.notNull()
			.references(() => user.id, { onDelete: "restrict" }),
		position: integer("position").notNull(),
		// NOTE: (rotation_id, position) uniqueness is enforced via a deferrable
		// constraint added in a SQL migration; drizzle has no deferrable index support.
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [uniqueIndex("rotation_member_rotation_assignee_idx").on(table.rotationId, table.assigneeId), index("rotation_member_rotation_idx").on(table.rotationId)],
);
