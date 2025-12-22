import { redirect } from "@tanstack/solid-router";
import { createMiddleware } from "@tanstack/solid-start";
import { getRequest, getRequestUrl } from "@tanstack/solid-start/server";
import { auth } from "~/lib/auth";

/**
 * Auth middleware that retrieves the session and adds it to the server context.
 * Use this with server functions that require authentication.
 *
 * @example
 * ```ts
 * export const getMyData = createServerFn({ method: "GET" })
 *   .middleware([authMiddleware])
 *   .handler(async ({ context }) => {
 *     const { session } = context;
 *     // session is guaranteed to exist here
 *   })
 * ```
 */
export const authMiddleware = createMiddleware({ type: "function" }).server(async ({ next }) => {
	const request = getRequest();
	const session = await auth.api.getSession({ headers: request.headers });

	if (!session?.user || !session.user.clientId) {
		throw redirect({ to: "/login", search: { redirect: getRequestUrl().toString() } });
	}

	return next({
		context: {
			session,
			user: session.user,
			userId: session.user.id,
			clientId: session.user.clientId,
		},
	});
});
