import { useQuery } from "@tanstack/solid-query";
import { useServerFn } from "@tanstack/solid-start";
import type { Accessor } from "solid-js";
import { runDemoAware } from "../demo/runtime";
import { getApiKeysDemo } from "../demo/store";
import { getApiKeys } from "./api-keys";

export function useApiKeys(options?: { enabled?: Accessor<boolean> }) {
	const getApiKeysFn = useServerFn(getApiKeys);
	return useQuery(() => ({
		queryKey: ["api-keys"],
		queryFn: () =>
			runDemoAware({
				demo: () => getApiKeysDemo(),
				remote: () => getApiKeysFn(),
			}),
		staleTime: 60_000,
		enabled: options?.enabled?.() ?? true,
	}));
}
