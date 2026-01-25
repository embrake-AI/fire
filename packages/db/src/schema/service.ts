import { index, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { client, user } from "./auth";
import { team } from "./team";

export const service = pgTable("service", {
	id: uuid("id").primaryKey().defaultRandom(),
	name: text("name").notNull(),
	description: text("description"),
	prompt: text("prompt"),
	imageUrl: text("image_url"),
	clientId: text("client_id")
		.notNull()
		.references(() => client.id, { onDelete: "cascade" }),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.defaultNow()
		.notNull()
		.$onUpdate(() => new Date()),
});

export const indexServiceClientId = index("index_service_client_id").on(service.clientId);

export const serviceTeamOwner = pgTable(
	"service_team_owner",
	{
		serviceId: uuid("service_id")
			.notNull()
			.references(() => service.id, { onDelete: "cascade" }),
		teamId: uuid("team_id")
			.notNull()
			.references(() => team.id, { onDelete: "cascade" }),
	},
	(t) => [primaryKey({ columns: [t.serviceId, t.teamId] }), index("service_team_owner_team_idx").on(t.teamId), index("service_team_owner_service_idx").on(t.serviceId)],
);

export const serviceUserOwner = pgTable(
	"service_user_owner",
	{
		serviceId: uuid("service_id")
			.notNull()
			.references(() => service.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(t) => [primaryKey({ columns: [t.serviceId, t.userId] }), index("service_user_owner_user_idx").on(t.userId), index("service_user_owner_service_idx").on(t.serviceId)],
);

export const serviceDependency = pgTable(
	"service_dependency",
	{
		baseServiceId: uuid("base_service_id")
			.notNull()
			.references(() => service.id, { onDelete: "cascade" }),
		affectedServiceId: uuid("affected_service_id")
			.notNull()
			.references(() => service.id, { onDelete: "cascade" }),
	},
	(t) => [
		primaryKey({ columns: [t.baseServiceId, t.affectedServiceId] }),
		index("service_dependency_base_idx").on(t.baseServiceId),
		index("service_dependency_affected_idx").on(t.affectedServiceId),
	],
);
