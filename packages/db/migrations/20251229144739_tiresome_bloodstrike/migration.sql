ALTER TYPE "assignee_type" ADD VALUE 'team';--> statement-breakpoint
CREATE TABLE "team" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"image_url" text,
	"client_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_member" (
	"team_id" uuid,
	"user_id" text,
	CONSTRAINT "team_member_pkey" PRIMARY KEY("team_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "entry_point" ADD COLUMN "team_id" uuid;--> statement-breakpoint
ALTER TABLE "rotation" ADD COLUMN "team_id" uuid;--> statement-breakpoint
ALTER TABLE "entry_point" ADD CONSTRAINT "entry_point_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "rotation" ADD CONSTRAINT "rotation_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "team" ADD CONSTRAINT "team_client_id_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;