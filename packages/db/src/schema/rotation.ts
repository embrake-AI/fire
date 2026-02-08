import { index, interval, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { client } from "./auth";
import { team } from "./team";

export const rotation = pgTable("rotation", {
	id: uuid("id").primaryKey().defaultRandom(),
	name: text("name").notNull(),
	slackChannelId: text("slack_channel_id"),
	clientId: text("client_id")
		.notNull()
		.references(() => client.id, { onDelete: "cascade" }),
	teamId: uuid("team_id").references(() => team.id, { onDelete: "cascade" }),
	anchorAt: timestamp("anchor_at", { withTimezone: true }).notNull(),
	shiftLength: interval("shift_length").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.$onUpdate(() => new Date()),
});

export const indexRotationClientId = index("index_rotation_client_id").on(rotation.clientId);
