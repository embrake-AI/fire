CREATE TABLE "client_billing" (
	"client_id" text PRIMARY KEY,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"stripe_subscription_item_id" text,
	"subscription_status" text,
	"last_seat_synced_count" integer,
	"last_seat_sync_attempt_at" timestamp with time zone,
	"last_seat_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "client_billing_stripe_customer_id_idx" ON "client_billing" ("stripe_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "client_billing_stripe_subscription_id_idx" ON "client_billing" ("stripe_subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "client_billing_stripe_subscription_item_id_idx" ON "client_billing" ("stripe_subscription_item_id");--> statement-breakpoint
ALTER TABLE "client_billing" ADD CONSTRAINT "client_billing_client_id_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client"("id") ON DELETE CASCADE;