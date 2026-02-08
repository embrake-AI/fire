export type ErrorToastMeta = {
	enabled?: boolean;
	userMessage?: string;
};

/**
 * Dashboard error contract:
 * - Throw `createUserFacingError(...)` in server functions for user-correctable failures.
 * - Throw `Error` for internal/system failures that should not be exposed directly.
 * - UI surfaces `UserFacingError` messages through the global mutation error handler.
 */

type MutationMetaRecord = {
	errorToast?: ErrorToastMeta;
};

type UserFacingErrorLike = {
	showToUser?: unknown;
	userMessage?: unknown;
	name?: unknown;
	message?: unknown;
};

export class UserFacingError extends Error {
	public readonly showToUser = true;
	public readonly userMessage: string;
	public readonly code?: string;

	constructor(userMessage: string, options?: { code?: string }) {
		super(userMessage);
		this.name = "UserFacingError";
		this.userMessage = userMessage;
		this.code = options?.code;
	}
}

export function createUserFacingError(userMessage: string, options?: { code?: string }): UserFacingError {
	return new UserFacingError(userMessage, options);
}

export function extractUserFacingMessage(error: unknown): string | null {
	if (error instanceof UserFacingError) {
		return error.userMessage;
	}

	if (!error || typeof error !== "object") {
		return null;
	}

	const candidate = error as UserFacingErrorLike;
	if (candidate.showToUser === true && typeof candidate.userMessage === "string" && candidate.userMessage.trim().length > 0) {
		return candidate.userMessage.trim();
	}

	if (candidate.name === "UserFacingError" && typeof candidate.message === "string" && candidate.message.trim().length > 0) {
		return candidate.message.trim();
	}

	return null;
}

export function errorToastMeta(meta: ErrorToastMeta): MutationMetaRecord {
	return { errorToast: meta };
}

export function readErrorToastMeta(meta: unknown): ErrorToastMeta | null {
	if (!meta || typeof meta !== "object") {
		return null;
	}

	const candidate = meta as MutationMetaRecord;
	if (!candidate.errorToast || typeof candidate.errorToast !== "object") {
		return null;
	}

	return candidate.errorToast;
}
