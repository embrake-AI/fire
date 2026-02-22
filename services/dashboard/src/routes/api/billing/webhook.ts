import { createFileRoute } from "@tanstack/solid-router";
import type Stripe from "stripe";
import { handleStripeWebhookEvent } from "~/lib/billing/billing.server";
import { getStripeClient } from "~/lib/billing/stripe";
import { mustGetEnv } from "~/lib/utils/server";

export const Route = createFileRoute("/api/billing/webhook")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const signature = request.headers.get("stripe-signature");
				if (!signature) {
					return new Response(JSON.stringify({ error: "Missing Stripe signature" }), {
						status: 400,
						headers: { "Content-Type": "application/json" },
					});
				}

				const payload = await request.text();
				let event: Stripe.Event;
				try {
					event = await getStripeClient().webhooks.constructEventAsync(payload, signature, mustGetEnv("STRIPE_WEBHOOK_SECRET"));
				} catch (error) {
					const message = error instanceof Error ? error.message : "Invalid webhook payload";
					return new Response(JSON.stringify({ error: message }), {
						status: 400,
						headers: { "Content-Type": "application/json" },
					});
				}

				try {
					await handleStripeWebhookEvent(event);
				} catch (error) {
					console.error("Failed to process Stripe webhook event", {
						eventId: event.id,
						eventType: event.type,
						error: error instanceof Error ? error.message : String(error),
					});
					return new Response(JSON.stringify({ error: "Webhook processing failed" }), {
						status: 500,
						headers: { "Content-Type": "application/json" },
					});
				}

				return new Response(JSON.stringify({ received: true }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			},
		},
	},
});
