import { createHmac } from "node:crypto";
import { session as sessionTable } from "@fire/db/schema";
import { createServerFn } from "@tanstack/solid-start";
import { getRequest, setCookie } from "@tanstack/solid-start/server";
import { eq } from "drizzle-orm";
import { auth } from "~/lib/auth/auth";
import { db } from "~/lib/db";
import { authMiddleware } from "./auth-middleware";
import { canStopImpersonation, requirePermission } from "./authorization";

export function signCookie(val: string, secret: string) {
	return `${val}.${createHmac("sha256", secret).update(val).digest("base64")}`;
}

function createRandomString(length: number) {
	const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
	let result = "";
	for (let i = 0; i < length; i++) {
		result += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return result;
}

export const startImpersonatingAction = createServerFn({ method: "POST" })
	.middleware([authMiddleware, requirePermission("impersonation.write")])
	.inputValidator((data: { userId: string }) => data)
	.handler(async ({ data, context }) => {
		const { userId } = data;
		const { user: adminUser } = context;

		const request = getRequest();
		const session = await auth.api.getSession({
			headers: request.headers,
		});

		if (!session) {
			throw new Error("No session found");
		}

		const adminToken = session.session.token;
		const impersonatedToken = createRandomString(32);

		const secret = process.env.BETTER_AUTH_SECRET;
		if (!secret) throw new Error("BETTER_AUTH_SECRET not set");

		const signedAdminToken = signCookie(adminToken, secret);
		const signedImpersonatedToken = signCookie(impersonatedToken, secret);

		await db.insert(sessionTable).values({
			id: crypto.randomUUID(),
			impersonatedBy: adminUser.id,
			token: impersonatedToken,
			userId: userId,
			expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
		});

		setCookie("admin_session", signedAdminToken, {
			httpOnly: true,
			secure: process.env.NODE_ENV === "production",
			sameSite: "lax",
			path: "/",
			maxAge: 60 * 60, // 1 hour in seconds
		});

		setCookie("better-auth.session_token", signedImpersonatedToken, {
			httpOnly: true,
			secure: process.env.NODE_ENV === "production",
			sameSite: "lax",
			path: "/",
			maxAge: 60 * 60, // 1 hour in seconds
		});

		return { success: true };
	});

export const stopImpersonatingAction = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.handler(async ({ context }) => {
		if (!canStopImpersonation(context)) {
			throw new Error("Only SUPER_ADMIN or active impersonation sessions can stop impersonation");
		}

		const request = getRequest();
		const session = await auth.api.getSession({
			headers: request.headers,
		});

		if (!session) {
			throw new Error("No session found");
		}

		// Get the admin session token from cookie
		const cookies = request.headers.get("cookie") || "";
		const adminSessionCookie = cookies
			.split(";")
			.find((c) => c.trim().startsWith("admin_session="))
			?.split("=")[1];

		if (!adminSessionCookie) {
			throw new Error("No admin session found in cookies");
		}

		// Delete the impersonated session from DB
		await db.delete(sessionTable).where(eq(sessionTable.id, session.session.id));

		// Clear admin_session and restore better-auth.session_token
		setCookie("admin_session", "", {
			path: "/",
			maxAge: 0,
		});

		setCookie("better-auth.session_token", decodeURIComponent(adminSessionCookie), {
			httpOnly: true,
			secure: process.env.NODE_ENV === "production",
			sameSite: "lax",
			path: "/",
			maxAge: 60 * 60, // 1 hour in seconds
		});

		return { success: true };
	});
