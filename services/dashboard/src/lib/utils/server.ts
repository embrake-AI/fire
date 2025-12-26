import { createHmac, timingSafeEqual } from "node:crypto";

export async function sha256(str: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(str);
	const hashBuffer = await crypto.subtle.digest("SHA-256", data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function mustGetEnv(name: string): string {
	const v = process.env[name];
	if (!v) throw new Error(`Missing env var: ${name}`);
	return v;
}

/**
 * Creates HMAC authentication headers for worker API calls.
 * Headers:
 * - X-Auth-Ts: Unix timestamp in seconds
 * - X-Auth-Message: JSON stringified {clientId, userId}
 * - X-Auth-Sig: base64url(HMAC_SHA256(secret, ts:message))
 */
export function createAuthHeaders(authContext: { clientId: string; userId: string }): Record<string, string> {
	const secret = mustGetEnv("WORKER_SIGNING_SECRET");
	const ts = Math.floor(Date.now() / 1000).toString();
	const message = JSON.stringify({ clientId: authContext.clientId, userId: authContext.userId });
	const baseString = `${ts}:${message}`;
	const signature = createHmac("sha256", secret).update(baseString).digest("base64url");

	return {
		"X-Auth-Ts": ts,
		"X-Auth-Message": message,
		"X-Auth-Sig": signature,
	};
}

/**
 * Wrapper around fetch that adds HMAC authentication headers for worker API calls.
 */
export async function signedFetch(url: string, authContext: { clientId: string; userId: string }, init?: RequestInit): Promise<Response> {
	const authHeaders = createAuthHeaders(authContext);
	const headers = new Headers(init?.headers);

	for (const [key, value] of Object.entries(authHeaders)) {
		headers.set(key, value);
	}

	return fetch(url, {
		...init,
		headers,
	});
}

export function sign(obj: Record<string, unknown>) {
	const secret = mustGetEnv("BETTER_AUTH_SECRET");
	const payload = JSON.stringify({ ...obj, ts: Date.now() });
	const encoded = Buffer.from(payload).toString("base64url");
	const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
	return `${encoded}.${signature}`;
}

export function extractSigned<T extends Record<string, unknown>>(signed: string): T | null {
	const secret = mustGetEnv("BETTER_AUTH_SECRET");
	const [encoded, signature] = signed.split(".");

	if (!encoded || !signature) {
		return null;
	}

	const expectedSignature = createHmac("sha256", secret).update(encoded).digest("base64url");

	try {
		const sigBuffer = Buffer.from(signature, "base64url");
		const expectedBuffer = Buffer.from(expectedSignature, "base64url");

		if (sigBuffer.length !== expectedBuffer.length || !timingSafeEqual(sigBuffer, expectedBuffer)) {
			return null;
		}
	} catch {
		return null;
	}

	try {
		const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
		if (!payload.clientId || !payload.userId) {
			return null;
		}

		return payload as T;
	} catch {
		return null;
	}
}
