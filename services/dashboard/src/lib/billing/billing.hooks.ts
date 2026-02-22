import { useMutation, useQuery } from "@tanstack/solid-query";
import { useServerFn } from "@tanstack/solid-start";
import { createBillingCheckoutSession, createBillingPortalSession, getWorkspaceBillingSummary } from "./billing";

export function useWorkspaceBillingSummary() {
	const getWorkspaceBillingSummaryFn = useServerFn(getWorkspaceBillingSummary);
	return useQuery(() => ({
		queryKey: ["workspace_billing_summary"],
		queryFn: () => getWorkspaceBillingSummaryFn(),
		staleTime: 30_000,
		suspense: false,
		throwOnError: false,
	}));
}

export function useCreateBillingCheckoutSession() {
	const createBillingCheckoutSessionFn = useServerFn(createBillingCheckoutSession);
	return useMutation(() => ({
		mutationFn: () => createBillingCheckoutSessionFn(),
	}));
}

export function useCreateBillingPortalSession() {
	const createBillingPortalSessionFn = useServerFn(createBillingPortalSession);
	return useMutation(() => ({
		mutationFn: () => createBillingPortalSessionFn(),
	}));
}
