DROP VIEW "rotationWithAssignee";--> statement-breakpoint
ALTER TABLE "rotation" ADD COLUMN "timezone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
CREATE VIEW "rotationWithAssignee" AS (
	select
		r.id as "id",
		r.name as "name",
		r.slack_channel_id as "slack_channel_id",
		r.client_id as "client_id",
		(s.shift_start_local at time zone r.timezone) as "shift_start",
		r.shift_length as "shift_length",
		r.timezone as "timezone",
		coalesce(m.assignees, '{}'::text[]) as "assignees",
		coalesce(o.assignee_id, b.base_assignee) as "effective_assignee",
		b.base_assignee as "base_assignee",
		r.created_at as "created_at",
		r.updated_at as "updated_at",
		r.team_id as "team_id"
	from "rotation" r
	left join lateral (
		select
			count(*)::int as n,
			array_agg(rm.assignee_id order by rm.position) as assignees
		from "rotation_member" rm
		where rm.rotation_id = r.id
	) m on true
	left join lateral (
		select
			r.anchor_at at time zone r.timezone as anchor_local,
			date_bin(r.shift_length, now() at time zone r.timezone, r.anchor_at at time zone r.timezone) as shift_start_local
	) s on true
	left join lateral (
		select rm.assignee_id as base_assignee
		from "rotation_member" rm
		where rm.rotation_id = r.id
			and rm.position = case
				when m.n = 0 then null
				else (
					(
						(
							floor(
								extract(epoch from (s.shift_start_local - s.anchor_local)) /
								extract(epoch from r.shift_length)
							)::bigint % m.n
						) + m.n
					) % m.n
				)::int
			end
		limit 1
	) b on true
	left join lateral (
		select ro.id, ro.assignee_id
		from "rotation_override" ro
		where ro.rotation_id = r.id
			and ro.start_at <= now()
			and ro.end_at > now()
		order by ro.created_at desc, ro.id desc
		limit 1
	) o on true
);