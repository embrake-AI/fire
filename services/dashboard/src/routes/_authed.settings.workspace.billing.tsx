import { createFileRoute } from "@tanstack/solid-router";
import { CreditCard, LoaderCircle } from "lucide-solid";
import { onMount, Show, Suspense } from "solid-js";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { showToast } from "~/components/ui/toast";
import { useCreateBillingCheckoutSession, useCreateBillingPortalSession, useWorkspaceBillingSummary } from "~/lib/billing/billing.hooks";
import { isDemoMode } from "~/lib/demo/mode";

export const Route = createFileRoute("/_authed/settings/workspace/billing")({
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
		<div class="rounded-xl bg-muted/20 px-4 py-2">
			<div class="py-3 space-y-4">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-3">
						<Skeleton class="size-10 rounded-lg" />
						<div class="space-y-1">
							<Skeleton class="h-4 w-28" />
							<Skeleton class="h-3 w-48" />
						</div>
					</div>
					<Skeleton class="h-9 w-28 rounded-md" />
				</div>
				<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
					<Skeleton class="h-16 rounded-lg" />
					<Skeleton class="h-16 rounded-lg" />
					<Skeleton class="h-16 rounded-lg" />
					<Skeleton class="h-16 rounded-lg" />
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
		<div class="rounded-xl bg-muted/20 px-4 py-2">
			<div class="py-3 space-y-4">
				<div class="flex items-center justify-between gap-3">
					<div class="flex items-center gap-3">
						<div class="flex items-center justify-center size-10 rounded-lg bg-muted">
							<CreditCard class="size-5" />
						</div>
						<div>
							<p class="text-sm font-medium text-foreground">Stripe billing</p>
							<p class="text-xs text-muted-foreground">Per-seat monthly billing based on unique rotation members</p>
						</div>
					</div>
					<Button onClick={() => (hasSubscription() ? handleManageBilling() : handleAddCard())} disabled={isActionPending() || billingSummaryQuery.isPending}>
						<Show when={isActionPending()}>
							<LoaderCircle class="w-4 h-4 animate-spin mr-2" />
						</Show>
						{hasSubscription() ? "Manage billing" : "Add card"}
					</Button>
				</div>

				<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
					<div class="rounded-lg border border-border/70 bg-background px-3 py-2">
						<p class="text-xs text-muted-foreground">Price / seat</p>
						<p class="text-sm font-medium text-foreground">
							{formatPricePerSeat(billingSummary()?.pricePerSeatCents ?? null, billingSummary()?.currency ?? null, billingSummary()?.billingInterval ?? null)}
						</p>
					</div>
					<div class="rounded-lg border border-border/70 bg-background px-3 py-2">
						<p class="text-xs text-muted-foreground">Billed seats</p>
						<p class="text-sm font-medium text-foreground">{billingSummary()?.billedSeatCount ?? "-"}</p>
					</div>
					<div class="rounded-lg border border-border/70 bg-background px-3 py-2">
						<p class="text-xs text-muted-foreground">Status</p>
						<p class="text-sm font-medium text-foreground">{formatSubscriptionStatus(billingSummary()?.subscriptionStatus ?? null)}</p>
					</div>
				</div>
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

function formatSubscriptionStatus(status: string | null): string {
	if (!status) {
		return "Not configured";
	}

	return status
		.split("_")
		.map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
		.join(" ");
}
