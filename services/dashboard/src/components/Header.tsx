import { useQueryClient } from "@tanstack/solid-query";
import { Link } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { Flame, Settings } from "lucide-solid";
import { getIncidents } from "~/lib/incidents";
import StartIncidentButton from "./StartIncidentButton";

export default function Header() {
	const queryClient = useQueryClient();
	const getIncidentsFn = useServerFn(getIncidents);

	const prefetchIncidents = () => {
		const state = queryClient.getQueryState(["incidents"]);
		if (state?.status === "success" && !state.isInvalidated) {
			return;
		}
		void queryClient.prefetchQuery({
			queryKey: ["incidents"],
			queryFn: getIncidentsFn,
			staleTime: 10_000,
		});
	};

	return (
		<header class="px-6 py-4 flex items-center justify-between bg-white border-b border-zinc-200">
			<Link to="/" class="flex items-center gap-2 text-zinc-900 hover:text-zinc-700 transition-colors" onMouseEnter={prefetchIncidents} onFocusIn={prefetchIncidents}>
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
