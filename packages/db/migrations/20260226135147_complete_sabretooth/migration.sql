CREATE TYPE "incident_terminal_status" AS ENUM('resolved', 'declined');--> statement-breakpoint
ALTER TABLE "incident_analysis" ADD COLUMN "terminal_status" "incident_terminal_status" DEFAULT 'resolved'::"incident_terminal_status" NOT NULL;--> statement-breakpoint
ALTER TABLE "incident_analysis" ADD COLUMN "decline_reason" text;