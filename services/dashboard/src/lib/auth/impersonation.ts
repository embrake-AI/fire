import { createHmac } from "node:crypto";
import { session as sessionTable, user as userTable } from "@fire/db/schema";
import { createServerFn } from "@tanstack/solid-start";
import { getRequest, setCookie } from "@tanstack/solid-start/server";
import { eq } from "drizzle-orm";
import { auth } from "~/lib/auth/auth";
import { db } from "~/lib/db";
import { createUserFacingError } from "../errors/user-facing-error";
import { authMiddleware } from "./auth-middleware";
import { canStopImpersonation, requirePermission } from "./authorization";

function signCookie(val: string, secret: string) {
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
		const userId = data.userId.trim();
		const { user: adminUser } = context;
		if (!userId) {
			throw createUserFacingError("Please select a user to impersonate.");
		}

		if (context.impersonatedBy) {
			throw createUserFacingError("Stop the current impersonation before starting a new one.");
		}

		if (userId === adminUser.id) {
			throw createUserFacingError("You are already signed in as this user.");
		}

		const [targetUser] = await db
			.select({
				id: userTable.id,
				clientId: userTable.clientId,
			})
			.from(userTable)
			.where(eq(userTable.id, userId))
			.limit(1);

		if (!targetUser) {
			throw createUserFacingError("User not found.");
		}
		if (!targetUser.clientId) {
			throw createUserFacingError("Selected user is missing a workspace assignment.");
		}

		const request = getRequest();
		const session = await auth.api.getSession({
			headers: request.headers,
		});

		if (!session) {
			throw createUserFacingError("Unable to start impersonation right now. Please sign in again.");
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
			userId,
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
			throw createUserFacingError("You don't have an active impersonation to stop.");
		}

		const request = getRequest();
		const session = await auth.api.getSession({
			headers: request.headers,
		});

		if (!session) {
			throw createUserFacingError("Unable to stop impersonation right now. Please sign in again.");
		}

		// Get the admin session token from cookie
		const cookies = request.headers.get("cookie") || "";
		const adminSessionCookie = cookies
			.split(";")
			.find((c) => c.trim().startsWith("admin_session="))
			?.split("=")[1];

		if (!adminSessionCookie) {
			throw createUserFacingError("Original admin session was not found.");
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
