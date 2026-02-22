import { integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { client } from "./auth";

export const clientBilling = pgTable(
	"client_billing",
	{
		clientId: text("client_id")
			.primaryKey()
			.references(() => client.id, { onDelete: "cascade" }),
		stripeCustomerId: text("stripe_customer_id"),
		stripeSubscriptionId: text("stripe_subscription_id"),
		stripeSubscriptionItemId: text("stripe_subscription_item_id"),
		subscriptionStatus: text("subscription_status"),
		lastSeatSyncedCount: integer("last_seat_synced_count"),
		lastSeatSyncAttemptAt: timestamp("last_seat_sync_attempt_at", { withTimezone: true }),
		lastSeatSyncedAt: timestamp("last_seat_synced_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		uniqueIndex("client_billing_stripe_customer_id_idx").on(table.stripeCustomerId),
		uniqueIndex("client_billing_stripe_subscription_id_idx").on(table.stripeSubscriptionId),
		uniqueIndex("client_billing_stripe_subscription_item_id_idx").on(table.stripeSubscriptionItemId),
	],
);
