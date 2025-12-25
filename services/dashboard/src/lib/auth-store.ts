import { createSignal } from "solid-js";
import { getAuthContext } from "~/lib/auth-context";

export interface AuthState {
	clientId: string | null;
	userId: string | null;
}

const [auth, setAuth] = createSignal<AuthState | null>(null);
const [ready, setReady] = createSignal(false);

let initialized = false;

/**
 * Initialize auth on the client side.
 * Call this once from RootShell to bootstrap auth.
 */
export function initializeAuth() {
	if (initialized) return;
	initialized = true;

	// Fetch auth context from server function (includes cookies automatically)
	getAuthContext()
		.then((res) => {
			setAuth({
				clientId: res.clientId ?? null,
				userId: res.userId ?? null,
			});
		})
		.catch(() => {
			// On error (network, 500, etc.), set auth to null
			setAuth({ clientId: null, userId: null });
		})
		.finally(() => {
			// Always set ready so the app doesn't get stuck
			setReady(true);
		});
}

/**
 * Get current auth state.
 * Returns null until auth is fetched.
 */
export function getAuth() {
	return auth();
}

/**
 * Check if auth has been fetched and is ready.
 */
export function isAuthReady() {
	return ready();
}

/**
 * Hook to use auth state reactively.
 */
export function useAuth() {
	return {
		auth,
		ready,
		get clientId() {
			return auth()?.clientId ?? null;
		},
		get userId() {
			return auth()?.userId ?? null;
		},
	};
}
