import { useQuery } from "@tanstack/solid-query";
import { useServerFn } from "@tanstack/solid-start";
import { getClient } from "./client";

export function useClient() {
	const getClientFn = useServerFn(getClient);
	return useQuery(() => ({
		queryKey: ["client"],
		queryFn: getClientFn,
		staleTime: Infinity,
	}));
}
