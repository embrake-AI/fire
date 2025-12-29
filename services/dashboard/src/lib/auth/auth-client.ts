import { createAuthClient } from "better-auth/client";

export const authClient = createAuthClient({
	baseURL: import.meta.env.VITE_APP_URL,
	fetch: (input: RequestInfo | URL, init?: RequestInit) =>
		fetch(input, {
			...init,
			credentials: "include",
		}),
});
