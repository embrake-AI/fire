import { sql } from "drizzle-orm";
import { interval, pgView, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { rotation } from "./rotation";
import { rotationMember } from "./rotation-member";
import { rotationOverride } from "./rotation-override";

export const rotationWithAssignee = pgView("rotationWithAssignee", {
	id: uuid("id").notNull(),
	name: text("name").notNull(),
	teamId: uuid("team_id"),
	clientId: text("client_id").notNull(),
	shiftStart: timestamp("shift_start", { withTimezone: true }),
	shiftLength: interval("shift_length").notNull(),
	assignees: text("assignees").array().notNull(),
	effectiveAssignee: text("effective_assignee"),
	baseAssignee: text("base_assignee"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}).as(sql`
	select
		r.id as "id",
		r.name as "name",
		r.client_id as "client_id",
		date_bin(r.shift_length, now(), r.anchor_at) as "shift_start",
		r.shift_length as "shift_length",
		coalesce(m.assignees, '{}'::text[]) as "assignees",
		coalesce(o.assignee_id, b.base_assignee) as "effective_assignee",
		b.base_assignee as "base_assignee",
		r.created_at as "created_at",
		r.updated_at as "updated_at",
		r.team_id as "team_id"
	from ${rotation} r
	left join lateral (
		select
			count(*)::int as n,
			array_agg(rm.assignee_id order by rm.position) as assignees
		from ${rotationMember} rm
		where rm.rotation_id = r.id
	) m on true
	left join lateral (
		select rm.assignee_id as base_assignee
		from ${rotationMember} rm
		where rm.rotation_id = r.id
			and rm.position = case
				when m.n = 0 then null
				else (
					(
						(
							floor(
								extract(epoch from (date_bin(r.shift_length, now(), r.anchor_at) - r.anchor_at)) /
								extract(epoch from r.shift_length)
							)::bigint % m.n
						) + m.n
					) % m.n
				)::int
			end
		limit 1
	) b on true
	left join lateral (
		select ro.assignee_id
		from ${rotationOverride} ro
		where ro.rotation_id = r.id
			and ro.start_at <= now()
			and ro.end_at > now()
		order by ro.created_at desc, ro.id desc
		limit 1
	) o on true
`);
