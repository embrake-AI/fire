import type { Context, Next } from "hono";

type AuthContext = {
	clientId: string;
	userId: string;
};
export type DashboardContext = {
	Bindings: Env;
	Variables: {
		auth: AuthContext;
	};
};

/**
 * Middleware to verify HMAC-signed requests from the dashboard.
 *
 * Expected headers:
 * - X-Auth-Ts: Unix timestamp in seconds
 * - X-Auth-Message: JSON stringified {clientId, userId}
 * - X-Auth-Sig: base64url(HMAC_SHA256(secret, ts:message))
 */
export async function verifyDashboardRequestMiddleware(c: Context<DashboardContext>, next: Next) {
	const ts = c.req.header("X-Auth-Ts");
	const message = c.req.header("X-Auth-Message");
	const sig = c.req.header("X-Auth-Sig");

	if (!ts || !message || !sig) {
		return c.json({ error: "Unauthorized: Missing authentication headers" }, 401);
	}

	// Verify timestamp is within 5 minutes
	const now = Math.floor(Date.now() / 1000);
	const tsNum = Number(ts);
	if (!Number.isFinite(tsNum) || Math.abs(now - tsNum) > 60 * 5) {
		return c.json({ error: "Unauthorized: Request expired" }, 401);
	}

	// Verify signature
	const baseString = `${ts}:${message}`;
	const isValid = await verifyHmacSignature(c.env.WORKER_SIGNING_SECRET, baseString, sig);

	if (!isValid) {
		return c.json({ error: "Unauthorized: Invalid signature" }, 401);
	}

	// Parse and validate message
	let authContext: AuthContext;
	try {
		const parsed = JSON.parse(message);
		if (!parsed.clientId || !parsed.userId) {
			return c.json({ error: "Unauthorized: Invalid auth context" }, 401);
		}
		authContext = {
			clientId: parsed.clientId,
			userId: parsed.userId,
		};
	} catch {
		return c.json({ error: "Unauthorized: Malformed auth message" }, 401);
	}

	// Set auth context for downstream handlers
	c.set("auth", authContext);

	await next();
}

async function verifyHmacSignature(secret: string, message: string, signature: string): Promise<boolean> {
	const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);

	const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));

	// Convert to base64url
	const base64 = btoa(String.fromCharCode(...new Uint8Array(mac)));
	const expected = base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

	// Timing-safe comparison
	if (expected.length !== signature.length) {
		return false;
	}

	let result = 0;
	for (let i = 0; i < expected.length; i++) {
		result |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
	}

	return result === 0;
}
