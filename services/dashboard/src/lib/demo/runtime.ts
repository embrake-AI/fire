import { isDemoMode } from "./mode";

export async function runDemoAware<T>(options: { demo: () => Promise<T>; remote: () => Promise<T> }): Promise<T> {
	if (isDemoMode()) {
		return options.demo();
	}
	return options.remote();
}
