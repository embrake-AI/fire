CREATE TYPE "affection_impact" AS ENUM('partial', 'major');--> statement-breakpoint
CREATE TYPE "affection_status" AS ENUM('investigating', 'mitigating', 'resolved');--> statement-breakpoint
CREATE TABLE "incident_affection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"incident_id" text NOT NULL,
	"title" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "incident_affection_service" (
	"affection_id" uuid,
	"service_id" uuid,
	"impact" "affection_impact" NOT NULL,
	CONSTRAINT "incident_affection_service_pkey" PRIMARY KEY("affection_id","service_id")
);
--> statement-breakpoint
CREATE TABLE "incident_affection_update" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"affection_id" uuid NOT NULL,
	"status" "affection_status",
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "status_page" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"client_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "status_page_service" (
	"status_page_id" uuid,
	"service_id" uuid,
	"position" integer,
	CONSTRAINT "status_page_service_pkey" PRIMARY KEY("status_page_id","service_id")
);
--> statement-breakpoint
CREATE INDEX "incident_affection_incident_idx" ON "incident_affection" ("incident_id");--> statement-breakpoint
CREATE INDEX "incident_affection_service_affection_idx" ON "incident_affection_service" ("affection_id");--> statement-breakpoint
CREATE INDEX "incident_affection_service_service_idx" ON "incident_affection_service" ("service_id");--> statement-breakpoint
CREATE INDEX "incident_affection_update_affection_idx" ON "incident_affection_update" ("affection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "status_page_slug_idx" ON "status_page" ("slug");--> statement-breakpoint
CREATE INDEX "status_page_service_page_idx" ON "status_page_service" ("status_page_id");--> statement-breakpoint
CREATE INDEX "status_page_service_service_idx" ON "status_page_service" ("service_id");--> statement-breakpoint
ALTER TABLE "incident_affection" ADD CONSTRAINT "incident_affection_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "incident_affection_service" ADD CONSTRAINT "incident_affection_service_Rzw4tfb6RGF5_fkey" FOREIGN KEY ("affection_id") REFERENCES "incident_affection"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "incident_affection_service" ADD CONSTRAINT "incident_affection_service_service_id_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "service"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "incident_affection_update" ADD CONSTRAINT "incident_affection_update_u1ECkZq8pMVr_fkey" FOREIGN KEY ("affection_id") REFERENCES "incident_affection"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "incident_affection_update" ADD CONSTRAINT "incident_affection_update_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "status_page" ADD CONSTRAINT "status_page_client_id_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "status_page_service" ADD CONSTRAINT "status_page_service_status_page_id_status_page_id_fkey" FOREIGN KEY ("status_page_id") REFERENCES "status_page"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "status_page_service" ADD CONSTRAINT "status_page_service_service_id_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "service"("id") ON DELETE CASCADE;
