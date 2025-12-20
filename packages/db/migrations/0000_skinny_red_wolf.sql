CREATE TYPE "public"."assignee_type" AS ENUM('slack-user', 'slack-user-group');--> statement-breakpoint
CREATE TYPE "public"."incident_status" AS ENUM('open', 'mitigating', 'resolved');--> statement-breakpoint
CREATE TABLE "assignee" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "assignee_type" NOT NULL,
	"identifier" text NOT NULL,
	"prompt" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "incident" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "incident_status" DEFAULT 'open' NOT NULL,
	"identifiers" text[] DEFAULT '{""}' NOT NULL
);