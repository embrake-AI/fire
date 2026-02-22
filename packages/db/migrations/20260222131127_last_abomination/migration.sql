ALTER TABLE "client" ADD COLUMN "is_startup_eligible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "client" ADD COLUMN "startup_discount_consumed_at" timestamp;