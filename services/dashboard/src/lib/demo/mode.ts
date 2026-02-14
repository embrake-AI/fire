export function isDemoMode(): boolean {
	if (typeof window === "undefined") {
		return false;
	}
	return window.location.hostname === import.meta.env.VITE_DEMO_HOSTNAME;
}
