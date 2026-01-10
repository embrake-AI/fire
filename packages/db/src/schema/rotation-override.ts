import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { rotation } from "./rotation";

export const rotationOverride = pgTable(
	"rotation_override",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		rotationId: uuid("rotation_id")
			.notNull()
			.references(() => rotation.id, { onDelete: "cascade" }),
		assigneeId: text("assignee_id")
			.notNull()
			.references(() => user.id, { onDelete: "restrict" }),
		startAt: timestamp("start_at", { withTimezone: true }).notNull(),
		endAt: timestamp("end_at", { withTimezone: true }).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		index("rotation_override_rotation_range_idx").on(table.rotationId, table.startAt, table.endAt),
		index("rotation_override_rotation_created_idx").on(table.rotationId, table.createdAt),
	],
);
