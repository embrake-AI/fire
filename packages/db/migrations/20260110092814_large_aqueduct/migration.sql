CREATE TABLE "rotation_member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"rotation_id" uuid NOT NULL,
	"assignee_id" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rotation_override" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"rotation_id" uuid NOT NULL,
	"assignee_id" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP VIEW "rotationWithAssignee";--> statement-breakpoint
ALTER TABLE "rotation" DROP COLUMN "assignees";--> statement-breakpoint
ALTER TABLE "rotation" DROP COLUMN "assignee_overwrite";--> statement-breakpoint
ALTER TABLE "rotation" DROP COLUMN "override_for_shift_start";--> statement-breakpoint
CREATE UNIQUE INDEX "rotation_member_rotation_assignee_idx" ON "rotation_member" ("rotation_id","assignee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rotation_member_rotation_position_idx" ON "rotation_member" ("rotation_id","position");--> statement-breakpoint
CREATE INDEX "rotation_member_rotation_idx" ON "rotation_member" ("rotation_id");--> statement-breakpoint
CREATE INDEX "rotation_override_rotation_range_idx" ON "rotation_override" ("rotation_id","start_at","end_at");--> statement-breakpoint
CREATE INDEX "rotation_override_rotation_created_idx" ON "rotation_override" ("rotation_id","created_at");--> statement-breakpoint
ALTER TABLE "rotation_member" ADD CONSTRAINT "rotation_member_rotation_id_rotation_id_fkey" FOREIGN KEY ("rotation_id") REFERENCES "rotation"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "rotation_member" ADD CONSTRAINT "rotation_member_assignee_id_user_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "rotation_override" ADD CONSTRAINT "rotation_override_rotation_id_rotation_id_fkey" FOREIGN KEY ("rotation_id") REFERENCES "rotation"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "rotation_override" ADD CONSTRAINT "rotation_override_assignee_id_user_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
CREATE VIEW "rotationWithAssignee" AS (
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
	from "rotation" r
	left join lateral (
		select
			count(*)::int as n,
			array_agg(rm.assignee_id order by rm.position) as assignees
		from "rotation_member" rm
		where rm.rotation_id = r.id
	) m on true
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
		from "rotation_override" ro
		where ro.rotation_id = r.id
			and ro.start_at <= now()
			and ro.end_at > now()
		order by ro.created_at desc, ro.id desc
		limit 1
	) o on true
);