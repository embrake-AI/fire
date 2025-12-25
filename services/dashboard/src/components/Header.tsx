import { useQueryClient } from "@tanstack/solid-query";
import { Link } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { Flame, Settings } from "lucide-solid";
import { onMount } from "solid-js";
import { getEntryPoints } from "~/lib/entry-points";
import { getIntegrations } from "~/lib/integrations";
import StartIncidentButton from "./StartIncidentButton";

export default function Header() {
	const queryClient = useQueryClient();

	// This is app-wide interesting data, so we prefetch it on mount
	const getEntryPointsFn = useServerFn(getEntryPoints);
	const getIntegrationsFn = useServerFn(getIntegrations);
	onMount(() => {
		void queryClient.prefetchQuery({ queryKey: ["entry-points"], queryFn: getEntryPointsFn, staleTime: 60_000 });
		void queryClient.prefetchQuery({ queryKey: ["integrations"], queryFn: getIntegrationsFn, staleTime: 60_000 });
	});
	return (
		<header class="px-6 py-4 flex items-center justify-between bg-white border-b border-zinc-200">
			<Link to="/" class="flex items-center gap-2 text-zinc-900 hover:text-zinc-700 transition-colors">
				<Flame class="w-6 h-6 text-orange-500" />
				<span class="text-lg font-semibold tracking-tight">Incidents</span>
			</Link>
			<div class="flex items-center gap-3">
				<StartIncidentButton />
				<Link to="/config/entry-points" class="p-2 rounded-lg text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors">
					<Settings class="w-5 h-5" />
				</Link>
			</div>
		</header>
	);
}
