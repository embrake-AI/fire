import { useQuery } from "@tanstack/solid-query";
import { useServerFn } from "@tanstack/solid-start";
import type { Accessor } from "solid-js";
import { getUsers } from "../teams/teams";

export function useUsers(options?: { enabled?: Accessor<boolean> }) {
	const getUsersFn = useServerFn(getUsers);
	return useQuery(() => ({
		queryKey: ["users"],
		queryFn: getUsersFn,
		staleTime: 60_000,
		enabled: options?.enabled?.() ?? true,
	}));
}
