CREATE TABLE "rotation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"client_id" text NOT NULL,
	"anchor_at" timestamp with time zone NOT NULL,
	"shift_length" interval NOT NULL,
	"assignees" text[] DEFAULT '{}'::text[] NOT NULL,
	"assignee_overwrite" text,
	"override_for_shift_start" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rotation" ADD CONSTRAINT "rotation_client_id_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client"("id") ON DELETE CASCADE;