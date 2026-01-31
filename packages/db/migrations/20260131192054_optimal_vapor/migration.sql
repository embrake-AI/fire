CREATE TABLE "incident_action" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"incident_id" text NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "incident_analysis" ADD COLUMN "timeline" jsonb;--> statement-breakpoint
ALTER TABLE "incident_analysis" ADD COLUMN "root_cause" text;--> statement-breakpoint
ALTER TABLE "incident_analysis" ADD COLUMN "impact" text;--> statement-breakpoint
CREATE INDEX "incident_action_incident_idx" ON "incident_action" ("incident_id");--> statement-breakpoint
ALTER TABLE "incident_action" ADD CONSTRAINT "incident_action_incident_id_incident_analysis_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incident_analysis"("id") ON DELETE CASCADE;