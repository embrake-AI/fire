import { useQuery } from "@tanstack/solid-query";
import { useServerFn } from "@tanstack/solid-start";
import type { Accessor } from "solid-js";
import { getApiKeys } from "./api-keys";

export function useApiKeys(options?: { enabled?: Accessor<boolean> }) {
	const getApiKeysFn = useServerFn(getApiKeys);
	return useQuery(() => ({
		queryKey: ["api-keys"],
		queryFn: getApiKeysFn,
		staleTime: 60_000,
		enabled: options?.enabled?.() ?? true,
	}));
}
