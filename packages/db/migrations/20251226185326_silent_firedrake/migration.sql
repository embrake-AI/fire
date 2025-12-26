CREATE TYPE "incident_severity" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "incident_source" AS ENUM('slack', 'dashboard');--> statement-breakpoint
CREATE TABLE "incident_analysis" (
	"id" text PRIMARY KEY,
	"client_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"severity" "incident_severity" NOT NULL,
	"assignee" text NOT NULL,
	"created_by" text NOT NULL,
	"source" "incident_source" NOT NULL,
	"prompt" text NOT NULL,
	"summary" text NOT NULL,
	"events" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "incident_analysis" ADD CONSTRAINT "incident_analysis_client_id_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client"("id") ON DELETE CASCADE;