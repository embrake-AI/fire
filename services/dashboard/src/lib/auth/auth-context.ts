import { createServerFn } from "@tanstack/solid-start";
import { getRequest } from "@tanstack/solid-start/server";
import { auth } from "./auth";

export const getAuthContext = createServerFn({ method: "GET" }).handler(async () => {
	const request = getRequest();
	const session = await auth.api.getSession({ headers: request.headers });
	return {
		clientId: session?.user?.clientId,
		userId: session?.user?.id,
		role: session?.user?.role,
		impersonatedBy: session?.session?.impersonatedBy,
	};
});
