import { useQuery } from "@tanstack/solid-query";
import { createFileRoute, Link } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { ChevronRight, CircleCheck, Search, ShieldAlert } from "lucide-solid";
import { createMemo, createSignal, For, Show, Suspense } from "solid-js";
import { Card } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { requireRoutePermission } from "~/lib/auth/route-guards";
import { runDemoAware } from "~/lib/demo/runtime";
import { getResolvedIncidentsDemo } from "~/lib/demo/store";
import { getSeverity } from "~/lib/incident-config";
import { getResolvedIncidents, type ResolvedIncident } from "~/lib/incidents/incidents";

export const Route = createFileRoute("/_authed/post-incidents")({
	beforeLoad: requireRoutePermission("metrics.read"),
	component: PostIncidentsPage,
});

function PostIncidentsPage() {
	return (
		<div class="flex-1 bg-background p-6 md:p-8">
			<div class="max-w-5xl mx-auto">
				<div class="mb-6 flex items-center gap-3">
					<div class="rounded-lg bg-muted p-2">
						<ShieldAlert class="h-5 w-5 text-muted-foreground" />
					</div>
					<h1 class="text-2xl font-semibold text-foreground">Post-Incidents</h1>
				</div>

				<Suspense>
					<PostIncidentsContent />
				</Suspense>
			</div>
		</div>
	);
}

function PostIncidentsContent() {
	const getResolvedIncidentsFn = useServerFn(getResolvedIncidents);
	const resolvedQuery = useQuery(() => ({
		queryKey: ["resolved-incidents"],
		queryFn: () =>
			runDemoAware({
				demo: () => getResolvedIncidentsDemo(),
				remote: () => getResolvedIncidentsFn(),
			}),
		staleTime: 60_000,
	}));

	const resolvedIncidents = () => resolvedQuery.data ?? [];

	const [search, setSearch] = createSignal("");

	const filtered = createMemo(() => {
		const q = search().toLowerCase().trim();
		if (!q) return resolvedIncidents();
		return resolvedIncidents().filter((inc) => inc.title.toLowerCase().includes(q) || inc.description?.toLowerCase().includes(q));
	});

	return (
		<Show when={resolvedIncidents().length > 0} fallback={<NoResolvedIncidents />}>
			<div class="space-y-4">
				<div class="flex items-center gap-3">
					<div class="relative max-w-xs">
						<Search class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
						<Input type="text" placeholder="Search incidents..." value={search()} onInput={(e) => setSearch(e.currentTarget.value)} class="pl-9" />
					</div>
					<span class="text-sm text-muted-foreground">
						{filtered().length} incident{filtered().length !== 1 ? "s" : ""}
					</span>
				</div>

				<div class="max-h-[70vh] overflow-y-auto pr-2">
					<Show
						when={filtered().length > 0}
						fallback={
							<div class="flex flex-col items-center justify-center py-12 text-center">
								<Search class="h-8 w-8 text-muted-foreground/40 mb-3" />
								<p class="text-sm text-muted-foreground">No incidents match your search.</p>
							</div>
						}
					>
						<section class="space-y-3">
							<For each={filtered()}>{(incident) => <ResolvedIncidentCard incident={incident} />}</For>
						</section>
					</Show>
				</div>
			</div>
		</Show>
	);
}

function NoResolvedIncidents() {
	return (
		<section class="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/15 px-6 py-14 text-center">
			<div class="relative mb-5">
				<div class="absolute inset-0 rounded-full bg-emerald-400/20 blur-xl" />
				<div class="relative rounded-full border border-emerald-200/60 bg-gradient-to-br from-emerald-100 to-emerald-50 p-4">
					<CircleCheck class="h-10 w-10 text-emerald-600" />
				</div>
			</div>
			<h2 class="mb-2 text-xl font-semibold text-foreground">No post-incidents yet</h2>
			<p class="max-w-md text-sm text-muted-foreground">Resolved incidents will appear here once incidents are marked as resolved.</p>
		</section>
	);
}

function ResolvedIncidentCard(props: { incident: ResolvedIncident }) {
	const severity = () => getSeverity(props.incident.severity);

	return (
		<Link to="/metrics/$incidentId" params={{ incidentId: props.incident.id }} class="block">
			<Card class="cursor-pointer bg-card p-4 transition-all hover:bg-muted/30">
				<div class="flex items-start justify-between gap-4">
					<div class="flex min-w-0 flex-1 items-start gap-3">
						<div class={`mt-0.5 shrink-0 ${severity().color}`}>{severity().icon("sm")}</div>
						<div class="min-w-0 flex-1">
							<h2 class="truncate font-medium text-foreground">{props.incident.title}</h2>
							<Show when={props.incident.description}>
								<p class="mt-1 line-clamp-2 text-sm text-muted-foreground">{props.incident.description}</p>
							</Show>
						</div>
					</div>
					<div class="flex shrink-0 items-center gap-3">
						<span class="text-sm text-muted-foreground">
							{new Date(props.incident.resolvedAt).toLocaleString(undefined, {
								month: "short",
								day: "numeric",
								hour: "2-digit",
								minute: "2-digit",
							})}
						</span>
						<ChevronRight class="h-4 w-4 text-muted-foreground/50" />
					</div>
				</div>
			</Card>
		</Link>
	);
}
