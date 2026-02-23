import { createFileRoute } from "@tanstack/solid-router";
import { CreditCard, LoaderCircle } from "lucide-solid";
import { onMount, Show, Suspense } from "solid-js";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { showToast } from "~/components/ui/toast";
import { requireRoutePermission } from "~/lib/auth/route-guards";
import { useCreateBillingCheckoutSession, useCreateBillingPortalSession, useWorkspaceBillingSummary } from "~/lib/billing/billing.hooks";
import { isDemoMode } from "~/lib/demo/mode";

export const Route = createFileRoute("/_authed/settings/workspace/billing")({
	beforeLoad: requireRoutePermission("settings.workspace.read"),
	component: WorkspaceBillingPage,
	validateSearch: (search) => ({
		billing: typeof search.billing === "string" ? search.billing : undefined,
	}),
});

function WorkspaceBillingPage() {
	return (
		<div class="space-y-8">
			<div>
				<h2 class="text-lg font-semibold text-foreground">Workspace Billing</h2>
				<p class="text-sm text-muted-foreground mt-1">Manage card details and seat-based monthly billing</p>
			</div>

			<Suspense fallback={<BillingSkeleton />}>
				<BillingContent />
			</Suspense>
		</div>
	);
}

function BillingSkeleton() {
	return (
		<div class="space-y-6">
			<div class="rounded-xl bg-muted/20 px-4 py-2">
				<div class="py-3">
					<div class="flex items-center justify-between gap-3">
						<div class="flex items-center gap-3">
							<Skeleton class="size-10 rounded-lg" />
							<div class="space-y-1.5">
								<Skeleton class="h-4 w-32" />
								<Skeleton class="h-3 w-44" />
							</div>
						</div>
						<Skeleton class="h-9 w-28 rounded-md" />
					</div>
				</div>
			</div>
			<div class="rounded-xl bg-muted/20 px-4 py-2">
				<div class="divide-y divide-border/40">
					<div class="flex items-center justify-between py-3">
						<Skeleton class="h-4 w-24" />
						<Skeleton class="h-4 w-16" />
					</div>
					<div class="flex items-center justify-between py-3">
						<Skeleton class="h-4 w-28" />
						<Skeleton class="h-4 w-20" />
					</div>
					<div class="flex items-center justify-between py-3">
						<Skeleton class="h-4 w-32" />
						<Skeleton class="h-4 w-24" />
					</div>
				</div>
			</div>
		</div>
	);
}

function BillingContent() {
	const search = Route.useSearch();
	const navigate = Route.useNavigate();
	const demoMode = isDemoMode();

	onMount(() => {
		const billing = search().billing ?? null;
		if (!billing) {
			return;
		}

		if (billing === "success") {
			showToast({
				title: "Billing configured",
				description: "Your workspace billing setup was completed successfully.",
				variant: "success",
			});
		}

		if (billing === "cancel") {
			showToast({
				title: "Billing setup canceled",
				description: "You can continue billing setup at any time.",
			});
		}

		navigate({ to: ".", search: { billing: undefined }, replace: true });
	});

	if (demoMode) {
		return <BillingDemoNotice />;
	}

	return <BillingSection />;
}

function BillingSection() {
	const billingSummaryQuery = useWorkspaceBillingSummary();
	const checkoutSessionMutation = useCreateBillingCheckoutSession();
	const portalSessionMutation = useCreateBillingPortalSession();

	const billingSummary = () => billingSummaryQuery.data;
	const hasSubscription = () => billingSummary()?.hasSubscription ?? false;
	const isActionPending = () => checkoutSessionMutation.isPending || portalSessionMutation.isPending;
	const startupDiscountPercentOff = () => billingSummary()?.startupDiscountPercentOff ?? null;
	const startupDiscountStatus = () =>
		resolveStartupDiscountStatus({
			hasActiveStartupDiscount: billingSummary()?.hasActiveStartupDiscount ?? false,
			startupDiscountConsumedAt: billingSummary()?.startupDiscountConsumedAt ?? null,
			isStartupEligible: billingSummary()?.isStartupEligible ?? false,
		});
	const hasActivePercentStartupDiscount = () => startupDiscountStatus() === "applied" && (startupDiscountPercentOff() ?? 0) > 0;
	const discountedPricePerSeatCents = () =>
		hasActivePercentStartupDiscount() ? applyPercentDiscountCents(billingSummary()?.pricePerSeatCents ?? null, startupDiscountPercentOff()) : null;
	const baseEstimatedTotalCents = () => {
		const pricePerSeatCents = billingSummary()?.pricePerSeatCents ?? null;
		const seats = billingSummary()?.billedSeatCount ?? null;
		if (pricePerSeatCents === null || seats === null) {
			return null;
		}

		return pricePerSeatCents * seats;
	};
	const discountedEstimatedTotalCents = () => (hasActivePercentStartupDiscount() ? applyPercentDiscountCents(baseEstimatedTotalCents(), startupDiscountPercentOff()) : null);
	const showStartupDiscountCallout = () => startupDiscountStatus() === "applied" || startupDiscountStatus() === "eligible";

	const handleAddCard = async () => {
		const result = await checkoutSessionMutation.mutateAsync();
		if (result?.url) {
			window.location.href = result.url;
		}
	};

	const handleManageBilling = async () => {
		const result = await portalSessionMutation.mutateAsync();
		if (result?.url) {
			window.location.href = result.url;
		}
	};

	return (
		<div class="space-y-6">
			{/* Payment method */}
			<div class="rounded-xl bg-muted/20 px-4 py-2">
				<div class="py-3">
					<div class="flex items-center justify-between gap-3">
						<div class="flex items-center gap-3">
							<div class="flex items-center justify-center size-10 rounded-lg bg-muted">
								<CreditCard class="size-5" />
							</div>
							<div>
								<div class="flex items-center gap-2">
									<p class="text-sm font-medium text-foreground">Payment method</p>
									<Badge variant={hasSubscription() ? "success" : "secondary"}>{hasSubscription() ? "Active" : "Not configured"}</Badge>
								</div>
								<Show when={billingSummary()?.cardBrand && billingSummary()?.cardLast4} fallback={<p class="text-xs text-muted-foreground mt-0.5">No payment method on file</p>}>
									<p class="text-xs text-muted-foreground mt-0.5">
										{billingSummary()!.cardBrand!.toUpperCase()} &bull;&bull;&bull;&bull; {billingSummary()!.cardLast4}
									</p>
								</Show>
							</div>
						</div>
						<Button onClick={() => (hasSubscription() ? handleManageBilling() : handleAddCard())} disabled={isActionPending() || billingSummaryQuery.isPending}>
							<Show when={isActionPending()}>
								<LoaderCircle class="w-4 h-4 animate-spin mr-2" />
							</Show>
							{hasSubscription() ? "Manage billing" : "Add card"}
						</Button>
					</div>
				</div>
			</div>

			{/* Usage & pricing */}
			<div class="rounded-xl bg-muted/20 px-4 py-2">
				<div class="divide-y divide-border/40">
					<div class="flex items-center justify-between py-3">
						<p class="text-sm text-muted-foreground">Billed seats</p>
						<p class="text-sm font-medium text-foreground">{billingSummary()?.billedSeatCount ?? "-"}</p>
					</div>
					<div class="flex items-center justify-between py-3">
						<p class="text-sm text-muted-foreground">Price per seat</p>
						<Show
							when={hasActivePercentStartupDiscount() && discountedPricePerSeatCents() !== null}
							fallback={
								<p class="text-sm font-medium text-foreground">
									{formatPricePerSeat(billingSummary()?.pricePerSeatCents ?? null, billingSummary()?.currency ?? null, billingSummary()?.billingInterval ?? null)}
								</p>
							}
						>
							<div class="text-right">
								<p class="text-xs text-muted-foreground line-through">
									{formatPricePerSeat(billingSummary()?.pricePerSeatCents ?? null, billingSummary()?.currency ?? null, billingSummary()?.billingInterval ?? null)}
								</p>
								<p class="text-sm font-medium text-emerald-600">
									{formatPricePerSeat(discountedPricePerSeatCents(), billingSummary()?.currency ?? null, billingSummary()?.billingInterval ?? null)}
								</p>
							</div>
						</Show>
					</div>
					<div class="flex items-center justify-between py-3">
						<p class="text-sm text-muted-foreground">Estimated total</p>
						<Show
							when={hasActivePercentStartupDiscount() && discountedEstimatedTotalCents() !== null}
							fallback={
								<p class="text-sm font-medium text-foreground">
									{formatEstimatedTotal(
										billingSummary()?.pricePerSeatCents ?? null,
										billingSummary()?.billedSeatCount ?? null,
										billingSummary()?.currency ?? null,
										billingSummary()?.billingInterval ?? null,
									)}
								</p>
							}
						>
							<div class="text-right">
								<p class="text-xs text-muted-foreground line-through">
									{formatEstimatedTotal(
										billingSummary()?.pricePerSeatCents ?? null,
										billingSummary()?.billedSeatCount ?? null,
										billingSummary()?.currency ?? null,
										billingSummary()?.billingInterval ?? null,
									)}
								</p>
								<p class="text-sm font-medium text-emerald-600">
									{formatTotalFromCents(discountedEstimatedTotalCents(), billingSummary()?.currency ?? null, billingSummary()?.billingInterval ?? null)}
								</p>
							</div>
						</Show>
					</div>
					<Show when={startupDiscountStatus()}>
						<div class="flex items-center justify-between py-3">
							<p class="text-sm text-muted-foreground">Startup discount</p>
							<p class="text-sm font-medium text-foreground">{formatStartupDiscountStatus(startupDiscountStatus(), startupDiscountPercentOff())}</p>
						</div>
					</Show>
				</div>

				<Show when={showStartupDiscountCallout()}>
					<div
						classList={{
							"my-3 rounded-lg border px-3 py-2": true,
							"border-emerald-200 bg-emerald-50/70": startupDiscountStatus() === "applied",
							"border-sky-200 bg-sky-50/70": startupDiscountStatus() === "eligible",
						}}
					>
						<p class="text-sm font-medium text-foreground">
							{startupDiscountStatus() === "applied"
								? `${formatDiscountPercent(startupDiscountPercentOff()) ?? "Startup"} discount applied`
								: `${formatDiscountPercent(startupDiscountPercentOff()) ?? "Startup"} discount available`}
						</p>
						<p class="text-xs text-muted-foreground mt-0.5">
							{startupDiscountStatus() === "applied"
								? "Your seat price and total include the active startup discount."
								: "This startup discount will be automatically applied when billing is configured."}
						</p>
					</div>
				</Show>
			</div>
		</div>
	);
}

function BillingDemoNotice() {
	return (
		<div class="rounded-xl bg-muted/20 px-4 py-2">
			<div class="py-3">
				<div class="flex items-center gap-3">
					<div class="flex items-center justify-center size-10 rounded-lg bg-muted">
						<CreditCard class="size-5" />
					</div>
					<div>
						<p class="text-sm font-medium text-foreground">Billing</p>
						<p class="text-xs text-muted-foreground">Billing is not available in demo mode.</p>
					</div>
				</div>
			</div>
		</div>
	);
}

function formatPricePerSeat(cents: number | null, currency: string | null, interval: string | null): string {
	if (cents === null || !currency) {
		return "Unavailable";
	}

	const amount = new Intl.NumberFormat(undefined, {
		style: "currency",
		currency: currency.toUpperCase(),
		maximumFractionDigits: 2,
	}).format(cents / 100);

	return interval ? `${amount}/${interval}` : amount;
}

function formatEstimatedTotal(cents: number | null, seats: number | null, currency: string | null, interval: string | null): string {
	if (cents === null || seats === null || !currency) {
		return "-";
	}

	const total = (cents * seats) / 100;
	const amount = new Intl.NumberFormat(undefined, {
		style: "currency",
		currency: currency.toUpperCase(),
		maximumFractionDigits: 2,
	}).format(total);

	return interval ? `${amount}/${interval}` : amount;
}

function formatTotalFromCents(totalCents: number | null, currency: string | null, interval: string | null): string {
	if (totalCents === null || !currency) {
		return "-";
	}

	const amount = new Intl.NumberFormat(undefined, {
		style: "currency",
		currency: currency.toUpperCase(),
		maximumFractionDigits: 2,
	}).format(totalCents / 100);

	return interval ? `${amount}/${interval}` : amount;
}

function applyPercentDiscountCents(cents: number | null, percentOff: number | null): number | null {
	if (cents === null || percentOff === null || percentOff <= 0) {
		return null;
	}

	return Math.max(0, Math.round(cents * ((100 - percentOff) / 100)));
}

function formatDiscountPercent(percentOff: number | null): string | null {
	if (percentOff === null || percentOff <= 0) {
		return null;
	}

	return `${percentOff}%`;
}

function resolveStartupDiscountStatus(params: { hasActiveStartupDiscount: boolean; startupDiscountConsumedAt: string | null; isStartupEligible: boolean }) {
	if (params.hasActiveStartupDiscount) {
		return "applied";
	}

	if (params.startupDiscountConsumedAt) {
		return "consumed";
	}

	if (params.isStartupEligible) {
		return "eligible";
	}

	return null;
}

function formatStartupDiscountStatus(status: "applied" | "consumed" | "eligible" | null, startupDiscountPercentOff: number | null): string {
	const discountPercent = formatDiscountPercent(startupDiscountPercentOff);
	if (status === "applied") {
		return discountPercent ? `Applied (${discountPercent} off)` : "Applied";
	}

	if (status === "consumed") {
		return "Consumed";
	}

	if (status === "eligible") {
		return discountPercent ? `Eligible (${discountPercent} off)` : "Eligible";
	}

	return "";
}
