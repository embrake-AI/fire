CREATE TABLE "service" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"description" text,
	"prompt" text,
	"client_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_team_owner" (
	"service_id" uuid,
	"team_id" uuid,
	CONSTRAINT "service_team_owner_pkey" PRIMARY KEY("service_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "service_user_owner" (
	"service_id" uuid,
	"user_id" text,
	CONSTRAINT "service_user_owner_pkey" PRIMARY KEY("service_id","user_id")
);
--> statement-breakpoint
DROP VIEW "rotationWithAssignee";--> statement-breakpoint
CREATE INDEX "service_team_owner_team_idx" ON "service_team_owner" ("team_id");--> statement-breakpoint
CREATE INDEX "service_team_owner_service_idx" ON "service_team_owner" ("service_id");--> statement-breakpoint
CREATE INDEX "service_user_owner_user_idx" ON "service_user_owner" ("user_id");--> statement-breakpoint
CREATE INDEX "service_user_owner_service_idx" ON "service_user_owner" ("service_id");--> statement-breakpoint
ALTER TABLE "service" ADD CONSTRAINT "service_client_id_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "service_team_owner" ADD CONSTRAINT "service_team_owner_service_id_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "service"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "service_team_owner" ADD CONSTRAINT "service_team_owner_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "service_user_owner" ADD CONSTRAINT "service_user_owner_service_id_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "service"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "service_user_owner" ADD CONSTRAINT "service_user_owner_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
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
		select ro.id, ro.assignee_id
		from "rotation_override" ro
		where ro.rotation_id = r.id
			and ro.start_at <= now()
			and ro.end_at > now()
		order by ro.created_at desc, ro.id desc
		limit 1
	) o on true
);