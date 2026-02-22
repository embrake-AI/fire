import { clientBilling, client as clientTable, rotation, rotationMember } from "@fire/db/schema";
import { waitUntil } from "@vercel/functions";
import { and, eq, isNull, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "../db";
import { createUserFacingError } from "../errors/user-facing-error";
import { getStripeClient, getStripeErrorDetails, isTransientStripeError } from "./stripe";

const ACTIVE_SUBSCRIPTION_STATUSES = new Set<Stripe.Subscription.Status>(["active", "trialing", "past_due", "incomplete", "unpaid", "paused"]);

type ClientBillingRow = typeof clientBilling.$inferSelect;

export type WorkspaceBillingSummary = {
	pricePerSeatCents: number | null;
	currency: string | null;
	billingInterval: Stripe.Price.Recurring.Interval | null;
	distinctSeatCount: number;
	billedSeatCount: number;
	subscriptionStatus: string | null;
	hasSubscription: boolean;
	cardBrand: string | null;
	cardLast4: string | null;
	isStartupEligible: boolean;
	startupDiscountConsumedAt: string | null;
	hasActiveStartupDiscount: boolean;
};

type ClientBillingPatch = {
	stripeCustomerId?: string | null;
	stripeSubscriptionId?: string | null;
	stripeSubscriptionItemId?: string | null;
	subscriptionStatus?: string | null;
	lastSeatSyncedCount?: number | null;
	lastSeatSyncAttemptAt?: Date | null;
	lastSeatSyncedAt?: Date | null;
};

type ClientStartupDiscountState = {
	isStartupEligible: boolean;
	startupDiscountConsumedAt: Date | null;
};

function parseStripeId(value: string | { id: string } | null | undefined): string | null {
	if (!value) {
		return null;
	}

	if (typeof value === "string") {
		return value;
	}

	return value.id;
}

function parseStripeCouponId(value: string | { id: string } | null | undefined): string | null {
	if (!value) {
		return null;
	}

	if (typeof value === "string") {
		return value;
	}

	return value.id;
}

function getClientIdFromMetadata(metadata: Stripe.Metadata | null | undefined): string | null {
	const raw = metadata?.clientId;
	if (!raw) {
		return null;
	}

	const value = raw.trim();
	return value.length > 0 ? value : null;
}

function getBillableSeatCount(distinctSeatCount: number): number {
	return Math.max(1, distinctSeatCount);
}

function resolveSeatSubscriptionItem(subscription: Stripe.Subscription, seatPriceId: string): Stripe.SubscriptionItem | null {
	if (subscription.items.data.length === 0) {
		return null;
	}

	const matchingPriceItem = subscription.items.data.find((item) => item.price.id === seatPriceId);
	return matchingPriceItem ?? subscription.items.data[0] ?? null;
}

async function sleep(milliseconds: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function runWithStripeRetries<T>(label: string, operation: () => Promise<T>): Promise<T> {
	const maxAttempts = 3;
	const baseBackoffMs = 300;
	let attempt = 0;

	for (;;) {
		try {
			return await operation();
		} catch (error) {
			const shouldRetry = attempt < maxAttempts - 1 && isTransientStripeError(error);
			if (!shouldRetry) {
				throw error;
			}

			attempt += 1;
			const delayMs = baseBackoffMs * 2 ** (attempt - 1);
			console.warn("Transient Stripe error; retrying billing operation", {
				label,
				attempt,
				delayMs,
				error: getStripeErrorDetails(error),
			});
			await sleep(delayMs);
		}
	}
}

async function getClientBilling(clientId: string): Promise<ClientBillingRow | null> {
	const [record] = await db.select().from(clientBilling).where(eq(clientBilling.clientId, clientId)).limit(1);
	return record ?? null;
}

async function getClientStartupDiscountState(clientId: string): Promise<ClientStartupDiscountState> {
	const [clientRecord] = await db
		.select({
			isStartupEligible: clientTable.isStartupEligible,
			startupDiscountConsumedAt: clientTable.startupDiscountConsumedAt,
		})
		.from(clientTable)
		.where(eq(clientTable.id, clientId))
		.limit(1);

	if (!clientRecord) {
		throw new Error("Could not resolve workspace for billing");
	}

	return {
		isStartupEligible: clientRecord.isStartupEligible,
		startupDiscountConsumedAt: clientRecord.startupDiscountConsumedAt,
	};
}

async function upsertClientBilling(clientId: string, patch: ClientBillingPatch): Promise<ClientBillingRow> {
	const existing = await getClientBilling(clientId);
	const now = new Date();

	const merged = {
		clientId,
		stripeCustomerId: patch.stripeCustomerId === undefined ? (existing?.stripeCustomerId ?? null) : patch.stripeCustomerId,
		stripeSubscriptionId: patch.stripeSubscriptionId === undefined ? (existing?.stripeSubscriptionId ?? null) : patch.stripeSubscriptionId,
		stripeSubscriptionItemId: patch.stripeSubscriptionItemId === undefined ? (existing?.stripeSubscriptionItemId ?? null) : patch.stripeSubscriptionItemId,
		subscriptionStatus: patch.subscriptionStatus === undefined ? (existing?.subscriptionStatus ?? null) : patch.subscriptionStatus,
		lastSeatSyncedCount: patch.lastSeatSyncedCount === undefined ? (existing?.lastSeatSyncedCount ?? null) : patch.lastSeatSyncedCount,
		lastSeatSyncAttemptAt: patch.lastSeatSyncAttemptAt === undefined ? (existing?.lastSeatSyncAttemptAt ?? null) : patch.lastSeatSyncAttemptAt,
		lastSeatSyncedAt: patch.lastSeatSyncedAt === undefined ? (existing?.lastSeatSyncedAt ?? null) : patch.lastSeatSyncedAt,
	};

	const [record] = await db
		.insert(clientBilling)
		.values({
			...merged,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: clientBilling.clientId,
			set: {
				...merged,
				updatedAt: now,
			},
		})
		.returning();

	return record;
}

async function getDistinctSeatCount(clientId: string): Promise<number> {
	const result = await db.execute<{ count: number }>(sql`
		select count(distinct ${rotationMember.assigneeId})::int as count
		from ${rotationMember}
		inner join ${rotation} on ${rotationMember.rotationId} = ${rotation.id}
		where ${rotation.clientId} = ${clientId}
	`);

	const rawCount = result.rows[0]?.count ?? 0;
	return Number.isFinite(rawCount) ? rawCount : Number(rawCount) || 0;
}

async function getSeatCounts(clientId: string): Promise<{ distinctSeatCount: number; billedSeatCount: number }> {
	const distinctSeatCount = await getDistinctSeatCount(clientId);
	return {
		distinctSeatCount,
		billedSeatCount: getBillableSeatCount(distinctSeatCount),
	};
}

async function upsertFromStripeSubscription(clientId: string, subscription: Stripe.Subscription): Promise<void> {
	const seatPriceId = process.env.STRIPE_SEAT_PRICE_ID;
	const subscriptionItemId = seatPriceId ? (resolveSeatSubscriptionItem(subscription, seatPriceId)?.id ?? null) : (subscription.items.data[0]?.id ?? null);
	await upsertClientBilling(clientId, {
		stripeCustomerId: parseStripeId(subscription.customer),
		stripeSubscriptionId: subscription.id,
		stripeSubscriptionItemId: subscriptionItemId,
		subscriptionStatus: subscription.status,
	});
}

async function resolveClientIdFromSubscription(subscription: Stripe.Subscription): Promise<string | null> {
	const metadataClientId = getClientIdFromMetadata(subscription.metadata);
	if (metadataClientId) {
		return metadataClientId;
	}

	const [existingBySubscription] = await db
		.select({ clientId: clientBilling.clientId })
		.from(clientBilling)
		.where(eq(clientBilling.stripeSubscriptionId, subscription.id))
		.limit(1);
	if (existingBySubscription) {
		return existingBySubscription.clientId;
	}

	const customerId = parseStripeId(subscription.customer);
	if (!customerId) {
		return null;
	}

	const [existingByCustomer] = await db.select({ clientId: clientBilling.clientId }).from(clientBilling).where(eq(clientBilling.stripeCustomerId, customerId)).limit(1);
	return existingByCustomer?.clientId ?? null;
}

async function syncBillingSeatsForClient(clientId: string): Promise<void> {
	const stripe = getStripeClient();
	const seatPriceId = process.env.STRIPE_SEAT_PRICE_ID;
	if (!seatPriceId) {
		throw new Error("Missing env var: STRIPE_SEAT_PRICE_ID");
	}

	const attemptAt = new Date();
	const billing = await upsertClientBilling(clientId, { lastSeatSyncAttemptAt: attemptAt });
	if (!billing.stripeSubscriptionId) {
		return;
	}

	let firstTargetBilledSeatCount: number | null = null;

	try {
		const subscription = await runWithStripeRetries("retrieve-subscription-for-seat-sync", () =>
			stripe.subscriptions.retrieve(billing.stripeSubscriptionId!, {
				expand: ["items.data.price"],
			}),
		);

		if (subscription.status === "canceled" || subscription.status === "incomplete_expired") {
			await upsertFromStripeSubscription(clientId, subscription);
			return;
		}

		const subscriptionItem = resolveSeatSubscriptionItem(subscription, seatPriceId);
		if (!subscriptionItem) {
			throw new Error("Could not resolve a Stripe subscription item for seat sync");
		}

		const firstCounts = await getSeatCounts(clientId);
		firstTargetBilledSeatCount = firstCounts.billedSeatCount;

		let updatedSubscription = await runWithStripeRetries("update-subscription-seat-quantity", () =>
			stripe.subscriptions.update(subscription.id, {
				proration_behavior: "create_prorations",
				items: [{ id: subscriptionItem.id, quantity: firstCounts.billedSeatCount }],
			}),
		);

		const secondCounts = await getSeatCounts(clientId);
		if (secondCounts.billedSeatCount !== firstCounts.billedSeatCount) {
			updatedSubscription = await runWithStripeRetries("update-subscription-seat-quantity-drift-correction", () =>
				stripe.subscriptions.update(subscription.id, {
					proration_behavior: "create_prorations",
					items: [{ id: subscriptionItem.id, quantity: secondCounts.billedSeatCount }],
				}),
			);
		}

		const syncedAt = new Date();
		const syncedSeatCount = secondCounts.billedSeatCount;
		const updatedSeatItem = resolveSeatSubscriptionItem(updatedSubscription, seatPriceId);

		await upsertClientBilling(clientId, {
			stripeCustomerId: parseStripeId(updatedSubscription.customer),
			stripeSubscriptionId: updatedSubscription.id,
			stripeSubscriptionItemId: updatedSeatItem?.id ?? subscriptionItem.id,
			subscriptionStatus: updatedSubscription.status,
			lastSeatSyncedCount: syncedSeatCount,
			lastSeatSyncedAt: syncedAt,
			lastSeatSyncAttemptAt: attemptAt,
		});
	} catch (error) {
		console.error("Billing seat sync failed", {
			clientId,
			attemptedBilledSeatCount: firstTargetBilledSeatCount,
			stripeSubscriptionId: billing.stripeSubscriptionId,
			stripeSubscriptionItemId: billing.stripeSubscriptionItemId,
			error: getStripeErrorDetails(error),
		});
		throw error;
	}
}

export function queueBillingSeatSync(clientId: string): void {
	const syncPromise = syncBillingSeatsForClient(clientId).catch(() => {
		// Logged in syncBillingSeatsForClient; intentionally swallowed so product mutations never fail on billing sync.
	});
	waitUntil(syncPromise);
}

async function ensureStripeCustomer(clientId: string): Promise<string> {
	const existingBilling = await getClientBilling(clientId);
	if (existingBilling?.stripeCustomerId) {
		return existingBilling.stripeCustomerId;
	}

	const [workspace] = await db.select({ name: clientTable.name }).from(clientTable).where(eq(clientTable.id, clientId)).limit(1);
	const stripe = getStripeClient();
	const createdCustomer = await runWithStripeRetries("create-customer", () =>
		stripe.customers.create({
			name: workspace?.name ?? "Fire workspace",
			metadata: { clientId },
		}),
	);

	await upsertClientBilling(clientId, { stripeCustomerId: createdCustomer.id });
	return createdCustomer.id;
}

function hasActiveSubscription(record: ClientBillingRow | null): boolean {
	if (!record?.stripeSubscriptionId || !record.subscriptionStatus) {
		return false;
	}

	return ACTIVE_SUBSCRIPTION_STATUSES.has(record.subscriptionStatus as Stripe.Subscription.Status);
}

function getCardSummaryFromPaymentMethod(paymentMethod: Stripe.PaymentMethod | null | undefined): { cardBrand: string | null; cardLast4: string | null } {
	if (!paymentMethod || paymentMethod.type !== "card" || !paymentMethod.card) {
		return {
			cardBrand: null,
			cardLast4: null,
		};
	}

	return {
		cardBrand: paymentMethod.card.brand ?? null,
		cardLast4: paymentMethod.card.last4 ?? null,
	};
}

async function getCustomerCardSummary(stripeCustomerId: string): Promise<{ cardBrand: string | null; cardLast4: string | null }> {
	const stripe = getStripeClient();
	const customer = await runWithStripeRetries("retrieve-customer-with-default-payment-method", () =>
		stripe.customers.retrieve(stripeCustomerId, {
			expand: ["invoice_settings.default_payment_method"],
		}),
	);

	if ("deleted" in customer && customer.deleted) {
		return {
			cardBrand: null,
			cardLast4: null,
		};
	}

	const defaultPaymentMethod = customer.invoice_settings.default_payment_method;
	if (defaultPaymentMethod && typeof defaultPaymentMethod !== "string") {
		return getCardSummaryFromPaymentMethod(defaultPaymentMethod);
	}

	if (typeof defaultPaymentMethod === "string") {
		const paymentMethod = await runWithStripeRetries("retrieve-default-payment-method", () => stripe.paymentMethods.retrieve(defaultPaymentMethod));
		return getCardSummaryFromPaymentMethod(paymentMethod);
	}

	const cardPaymentMethods = await runWithStripeRetries("list-customer-card-payment-methods", () =>
		stripe.paymentMethods.list({
			customer: stripeCustomerId,
			type: "card",
			limit: 1,
		}),
	);

	return getCardSummaryFromPaymentMethod(cardPaymentMethods.data[0] ?? null);
}

function getSubscriptionDiscountCouponIds(subscription: Stripe.Subscription): string[] {
	const couponIds: string[] = [];

	for (const discountEntry of subscription.discounts ?? []) {
		if (typeof discountEntry === "string") {
			continue;
		}

		const couponId = parseStripeCouponId(discountEntry.coupon as string | { id: string } | null | undefined);
		if (couponId) {
			couponIds.push(couponId);
		}
	}

	return couponIds;
}

async function hasActiveConfiguredStartupDiscount(subscriptionId: string, startupCouponId: string): Promise<boolean> {
	const stripe = getStripeClient();
	const subscription = await runWithStripeRetries("retrieve-subscription-for-startup-discount", () =>
		stripe.subscriptions.retrieve(subscriptionId, {
			expand: ["discounts"],
		}),
	);

	const discountCouponIds = getSubscriptionDiscountCouponIds(subscription);
	return discountCouponIds.includes(startupCouponId);
}

async function markStartupDiscountConsumedIfApplicable(clientId: string, subscription: Stripe.Subscription): Promise<void> {
	const startupCouponId = process.env.STRIPE_STARTUP_COUPON_ID?.trim() ?? "";
	if (!startupCouponId) {
		return;
	}

	const discountCouponIds = getSubscriptionDiscountCouponIds(subscription);
	if (!discountCouponIds.includes(startupCouponId)) {
		return;
	}

	const now = new Date();
	await db
		.update(clientTable)
		.set({
			startupDiscountConsumedAt: now,
			updatedAt: now,
		})
		.where(and(eq(clientTable.id, clientId), isNull(clientTable.startupDiscountConsumedAt)));
}

export async function getWorkspaceBillingSummaryForClient(clientId: string): Promise<WorkspaceBillingSummary> {
	const seatPriceId = process.env.STRIPE_SEAT_PRICE_ID;
	const startupCouponId = process.env.STRIPE_STARTUP_COUPON_ID?.trim() ?? null;
	if (!seatPriceId) {
		throw new Error("Missing env var: STRIPE_SEAT_PRICE_ID");
	}

	const [billing, seatCounts, startupState] = await Promise.all([getClientBilling(clientId), getSeatCounts(clientId), getClientStartupDiscountState(clientId)]);

	let pricePerSeatCents: number | null = null;
	let currency: string | null = null;
	let billingInterval: Stripe.Price.Recurring.Interval | null = null;
	let cardBrand: string | null = null;
	let cardLast4: string | null = null;
	let hasActiveStartupDiscount = false;
	try {
		const stripe = getStripeClient();
		const price = await runWithStripeRetries("retrieve-seat-price", () => stripe.prices.retrieve(seatPriceId));
		pricePerSeatCents = price.unit_amount;
		currency = price.currency;
		billingInterval = price.recurring?.interval ?? null;
	} catch (error) {
		console.error("Failed to retrieve Stripe seat price", {
			clientId,
			seatPriceId,
			error: getStripeErrorDetails(error),
		});
	}

	if (billing?.stripeCustomerId) {
		try {
			const cardSummary = await getCustomerCardSummary(billing.stripeCustomerId);
			cardBrand = cardSummary.cardBrand;
			cardLast4 = cardSummary.cardLast4;
		} catch (error) {
			console.error("Failed to retrieve Stripe customer card summary", {
				clientId,
				stripeCustomerId: billing.stripeCustomerId,
				error: getStripeErrorDetails(error),
			});
		}
	}

	if (startupCouponId && billing?.stripeSubscriptionId) {
		try {
			hasActiveStartupDiscount = await hasActiveConfiguredStartupDiscount(billing.stripeSubscriptionId, startupCouponId);
		} catch (error) {
			console.error("Failed to resolve startup discount status", {
				clientId,
				stripeSubscriptionId: billing.stripeSubscriptionId,
				startupCouponId,
				error: getStripeErrorDetails(error),
			});
		}
	}

	return {
		pricePerSeatCents,
		currency,
		billingInterval,
		distinctSeatCount: seatCounts.distinctSeatCount,
		billedSeatCount: seatCounts.billedSeatCount,
		subscriptionStatus: billing?.subscriptionStatus ?? null,
		hasSubscription: hasActiveSubscription(billing),
		cardBrand,
		cardLast4,
		isStartupEligible: startupState.isStartupEligible,
		startupDiscountConsumedAt: startupState.startupDiscountConsumedAt ? startupState.startupDiscountConsumedAt.toISOString() : null,
		hasActiveStartupDiscount,
	};
}

export async function createBillingCheckoutSessionForClient(clientId: string): Promise<{ url: string }> {
	const seatPriceId = process.env.STRIPE_SEAT_PRICE_ID;
	const appUrl = process.env.VITE_APP_URL;
	const startupCouponId = process.env.STRIPE_STARTUP_COUPON_ID?.trim() ?? "";
	if (!seatPriceId) {
		throw new Error("Missing env var: STRIPE_SEAT_PRICE_ID");
	}
	if (!appUrl) {
		throw new Error("Missing env var: VITE_APP_URL");
	}

	const existingBilling = await getClientBilling(clientId);
	if (hasActiveSubscription(existingBilling)) {
		throw createUserFacingError("Billing is already configured for this workspace. Use Manage billing.");
	}

	const startupState = await getClientStartupDiscountState(clientId);
	const shouldApplyStartupDiscount = startupState.isStartupEligible && !startupState.startupDiscountConsumedAt;
	if (shouldApplyStartupDiscount && !startupCouponId) {
		console.error("Missing startup coupon configuration for eligible workspace", {
			clientId,
			isStartupEligible: startupState.isStartupEligible,
			startupDiscountConsumedAt: startupState.startupDiscountConsumedAt?.toISOString() ?? null,
		});
		throw createUserFacingError("Billing setup is temporarily unavailable. Please contact support.");
	}

	const customerId = await ensureStripeCustomer(clientId);
	const { billedSeatCount } = await getSeatCounts(clientId);
	const stripe = getStripeClient();

	const checkoutSession = await runWithStripeRetries("create-checkout-session", () =>
		stripe.checkout.sessions.create({
			mode: "subscription",
			customer: customerId,
			client_reference_id: clientId,
			success_url: `${appUrl}/settings/workspace/billing?billing=success`,
			cancel_url: `${appUrl}/settings/workspace/billing?billing=cancel`,
			line_items: [{ price: seatPriceId, quantity: billedSeatCount }],
			subscription_data: {
				metadata: {
					clientId,
				},
			},
			...(shouldApplyStartupDiscount ? { discounts: [{ coupon: startupCouponId }] } : {}),
			metadata: {
				clientId,
			},
		}),
	);

	await upsertClientBilling(clientId, {
		stripeCustomerId: customerId,
		lastSeatSyncAttemptAt: new Date(),
	});

	if (!checkoutSession.url) {
		throw new Error("Stripe checkout session did not return a redirect URL");
	}

	return { url: checkoutSession.url };
}

export async function createBillingPortalSessionForClient(clientId: string): Promise<{ url: string }> {
	const appUrl = process.env.VITE_APP_URL;
	if (!appUrl) {
		throw new Error("Missing env var: VITE_APP_URL");
	}

	const billing = await getClientBilling(clientId);
	if (!billing?.stripeCustomerId) {
		throw createUserFacingError("Billing has not been configured for this workspace yet.");
	}

	const stripe = getStripeClient();
	const portalSession = await runWithStripeRetries("create-portal-session", () =>
		stripe.billingPortal.sessions.create({
			customer: billing.stripeCustomerId!,
			return_url: `${appUrl}/settings/workspace/billing`,
		}),
	);

	return { url: portalSession.url };
}

export async function handleStripeWebhookEvent(event: Stripe.Event): Promise<void> {
	const stripe = getStripeClient();

	switch (event.type) {
		case "checkout.session.completed": {
			const session = event.data.object as Stripe.Checkout.Session;
			if (session.mode !== "subscription") {
				return;
			}

			const clientId = session.client_reference_id ?? getClientIdFromMetadata(session.metadata);
			if (!clientId) {
				console.error("Stripe checkout completion missing clientId metadata", { eventId: event.id, sessionId: session.id });
				return;
			}

			const customerId = parseStripeId(session.customer as string | { id: string } | null | undefined);
			const subscriptionId = parseStripeId(session.subscription as string | { id: string } | null | undefined);

			if (!subscriptionId) {
				await upsertClientBilling(clientId, {
					stripeCustomerId: customerId,
				});
				return;
			}

			const subscription = await runWithStripeRetries("retrieve-subscription-after-checkout", () =>
				stripe.subscriptions.retrieve(subscriptionId, {
					expand: ["items.data.price", "discounts"],
				}),
			);
			await upsertFromStripeSubscription(clientId, subscription);
			await markStartupDiscountConsumedIfApplicable(clientId, subscription);
			return;
		}
		case "customer.subscription.created":
		case "customer.subscription.updated":
		case "customer.subscription.deleted": {
			const subscription = event.data.object as Stripe.Subscription;
			const clientId = await resolveClientIdFromSubscription(subscription);
			if (!clientId) {
				console.error("Unable to map Stripe subscription event to client", {
					eventId: event.id,
					subscriptionId: subscription.id,
					customerId: parseStripeId(subscription.customer),
					subscriptionMetadata: subscription.metadata,
				});
				return;
			}

			await upsertFromStripeSubscription(clientId, subscription);
			await markStartupDiscountConsumedIfApplicable(clientId, subscription);
			return;
		}
		default:
			return;
	}
}
