import { pgEnum, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { client, user } from "./auth";

export const team = pgTable("team", {
	id: uuid("id").primaryKey().defaultRandom(),
	name: text("name").notNull(),
	imageUrl: text("image_url"),
	clientId: text("client_id")
		.notNull()
		.references(() => client.id, { onDelete: "cascade" }),
	createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const teamMemberRole = pgEnum("team_member_role", ["MEMBER", "ADMIN"]);

export const teamMember = pgTable(
	"team_member",
	{
		teamId: uuid("team_id")
			.notNull()
			.references(() => team.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		role: teamMemberRole("role").notNull().default("ADMIN"),
	},
	(t) => [primaryKey({ columns: [t.teamId, t.userId] })],
);
