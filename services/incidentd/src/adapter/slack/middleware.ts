import type { Context, Next } from "hono";

type SlackContext = { Bindings: Env } & { Variables: { auth?: { clientId: string } } };

export async function verifySlackRequestMiddleware(c: Context<SlackContext>, next: Next) {
	const rawBody = await c.req.raw.clone().text();
	if (!(await verifySlackRequest(c, rawBody))) {
		return c.json({ error: "Unauthorized" }, 401);
	}
	await next();
}

async function verifySlackRequest(c: Context<SlackContext>, rawBody: string) {
	const ts = c.req.header("X-Slack-Request-Timestamp");
	const sig = c.req.header("X-Slack-Signature");
	if (!ts || !sig) return false;

	const now = Math.floor(Date.now() / 1000);
	const tsNum = Number(ts);
	if (!Number.isFinite(tsNum) || Math.abs(now - tsNum) > 60 * 5) return false;

	const baseString = `v0:${ts}:${rawBody}`;

	const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(c.env.SLACK_SIGNING_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);

	const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(baseString));
	const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
	const expected = `v0=${hex}`;

	return expected === sig;
}
