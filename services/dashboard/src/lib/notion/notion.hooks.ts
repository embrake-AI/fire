import { useMutation, useQuery } from "@tanstack/solid-query";
import { useServerFn } from "@tanstack/solid-start";
import type { Accessor } from "solid-js";
import { exportToNotion, getNotionPages } from "./notion-export";

export function useNotionPages(options: Accessor<{ query?: string }>) {
	const getNotionPagesFn = useServerFn(getNotionPages);

	return useQuery(() => ({
		queryKey: ["notion-pages", options().query],
		queryFn: () => getNotionPagesFn({ data: { query: options().query } }),
		staleTime: 30_000,
	}));
}

export function useExportToNotion() {
	const exportToNotionFn = useServerFn(exportToNotion);

	return useMutation(() => ({
		mutationFn: (data: { incidentId: string; parentPageId: string }) => exportToNotionFn({ data }),
	}));
}
