import { createServerFn } from "@tanstack/solid-start";
import { authMiddleware } from "../auth/auth-middleware";
import { requirePermission } from "../auth/authorization";
import { createBillingCheckoutSessionForClient, createBillingPortalSessionForClient, getWorkspaceBillingSummaryForClient } from "./billing.server";

export const getWorkspaceBillingSummary = createServerFn({ method: "GET" })
	.middleware([authMiddleware, requirePermission("settings.workspace.read")])
	.handler(async ({ context }) => {
		return getWorkspaceBillingSummaryForClient(context.clientId);
	});

export const createBillingCheckoutSession = createServerFn({ method: "POST" })
	.middleware([authMiddleware, requirePermission("settings.workspace.write")])
	.handler(async ({ context }) => {
		return createBillingCheckoutSessionForClient(context.clientId);
	});

export const createBillingPortalSession = createServerFn({ method: "POST" })
	.middleware([authMiddleware, requirePermission("settings.workspace.write")])
	.handler(async ({ context }) => {
		return createBillingPortalSessionForClient(context.clientId);
	});
