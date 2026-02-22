import Stripe from "stripe";
import { mustGetEnv } from "../utils/server";

export function getStripeClient() {
	return new Stripe(mustGetEnv("STRIPE_SECRET_KEY"));
}

export function isTransientStripeError(error: unknown): boolean {
	const candidate = error as {
		statusCode?: number;
		type?: string;
		code?: string;
	};

	if (candidate.statusCode === 429) {
		return true;
	}

	if (typeof candidate.statusCode === "number" && candidate.statusCode >= 500) {
		return true;
	}

	if (candidate.type === "StripeConnectionError" || candidate.type === "StripeAPIError" || candidate.type === "RateLimitError") {
		return true;
	}

	if (candidate.code === "lock_timeout") {
		return true;
	}

	return false;
}

export function getStripeErrorDetails(error: unknown) {
	const candidate = error as {
		type?: string;
		code?: string;
		statusCode?: number;
		message?: string;
	};

	return {
		type: candidate.type ?? "UnknownStripeError",
		code: candidate.code ?? null,
		statusCode: candidate.statusCode ?? null,
		message: candidate.message ?? (error instanceof Error ? error.message : String(error)),
	};
}
