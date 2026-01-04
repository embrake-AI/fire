import type { ListIncidentsElement } from "@fire/common";
import { createFileRoute, Link } from "@tanstack/solid-router";
import { ChevronRight, CircleCheck, Flame, Settings } from "lucide-solid";
import type { JSX } from "solid-js";
import { createMemo, createSignal, For, onMount, Show, Suspense } from "solid-js";
import { ResolvedIncidents } from "~/components/ResolvedIncidents";
import StartIncidentButton from "~/components/StartIncidentButton";
import { Card } from "~/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible";
import { getSeverity } from "~/lib/incident-config";
import { useIncidents } from "~/lib/incidents/incidents.hooks";

export const Route = createFileRoute("/_authed/")({
	component: IncidentsList,
});

function IncidentsList() {
	const incidentsQuery = useIncidents();

	const hasActiveIncidents = createMemo(() => {
		const incidents = incidentsQuery.data ?? [];
		return incidents.some((inc) => inc.status === "open" || inc.status === "mitigating");
	});

	return (
		<div class="flex-1 bg-background p-6 md:p-8 flex flex-col h-screen overflow-hidden">
			<div class="max-w-5xl mx-auto w-full flex-1 flex flex-col overflow-hidden">
				<div class="flex items-center justify-between mb-6">
					<div class="flex items-center gap-3">
						<div class={hasActiveIncidents() ? "p-2 rounded-lg bg-red-100" : "p-2 rounded-lg bg-muted"}>
							<Flame class={hasActiveIncidents() ? "w-5 h-5 text-red-500" : "w-5 h-5 text-muted-foreground"} />
						</div>
						<h1 class="text-2xl font-semibold text-foreground">Incidents</h1>
					</div>
					<StartIncidentButton />
				</div>
				<Suspense>
					<IncidentsContent />
				</Suspense>
			</div>
		</div>
	);
}

function IncidentsContent() {
	const incidentsQuery = useIncidents();
	const incidents = () => incidentsQuery.data ?? [];

	const severityOrder = { high: 0, medium: 1, low: 2 } as const;
	const sortBySeverity = (a: ListIncidentsElement, b: ListIncidentsElement) => severityOrder[a.severity] - severityOrder[b.severity];

	const openIncidents = createMemo(() =>
		incidents()
			.filter((inc) => inc.status === "open")
			.sort(sortBySeverity),
	);
	const mitigatingIncidents = createMemo(() =>
		incidents()
			.filter((inc) => inc.status === "mitigating")
			.sort(sortBySeverity),
	);

	const OpenIncidentsSection = (): JSX.Element => (
		<IncidentSection icon={<Flame class="w-5 h-5 text-red-500" />} iconBg="bg-red-100" title="Active Incidents" incidents={openIncidents()} />
	);

	const MitigatingIncidentsSection = (): JSX.Element => (
		<IncidentSection icon={<Settings class="w-5 h-5 text-amber-500" />} iconBg="bg-amber-100" title="Being Mitigated" incidents={mitigatingIncidents()} />
	);

	const openAndMitigatingIncidents = () => openIncidents().length > 0 && mitigatingIncidents().length > 0;
	const onlyMitigatingIncidents = () => mitigatingIncidents().length > 0 && openIncidents().length === 0;
	const noActiveIncidents = () => openIncidents().length === 0 && mitigatingIncidents().length === 0;

	return (
		<>
			<div class="space-y-8 flex-1 overflow-y-auto pr-1">
				<Show when={noActiveIncidents()}>
					<NoIncidents />
				</Show>

				<Show when={onlyMitigatingIncidents()}>{MitigatingIncidentsSection()}</Show>
				<Show when={openIncidents().length > 0}>{OpenIncidentsSection()}</Show>
				<Show when={openAndMitigatingIncidents()}>{MitigatingIncidentsSection()}</Show>
			</div>

			<Suspense>
				<ResolvedIncidents />
			</Suspense>
		</>
	);
}

function NoIncidents() {
	const [mounted, setMounted] = createSignal(false);
	onMount(() => {
		requestAnimationFrame(() => {
			setMounted(true);
		});
	});
	return (
		<section
			class="flex flex-col items-center justify-center py-16 px-6 transition-opacity transition-transform duration-300 ease-out will-change-[opacity,transform]"
			classList={{
				"invisible scale-95": !mounted(),
				"visible scale-100": mounted(),
			}}
		>
			<div class="relative mb-6">
				<div class="absolute inset-0 bg-emerald-400/20 rounded-full blur-xl animate-pulse" />
				<div class="relative p-4 rounded-full bg-gradient-to-br from-emerald-100 to-emerald-50 border border-emerald-200/60">
					<CircleCheck class="w-10 h-10 text-emerald-600" />
				</div>
			</div>
			<h2 class="text-2xl font-semibold text-foreground mb-2">All Systems Operational</h2>
			<p class="text-muted-foreground text-center max-w-md">No active incidents at this time. All services are running normally.</p>
		</section>
	);
}

function IncidentSection(props: { icon: JSX.Element; iconBg: string; title: string; incidents: ListIncidentsElement[]; muted?: boolean; collapsible?: boolean }) {
	const incidentsList = () => (
		<div class="space-y-3">
			<For each={props.incidents}>{(incident) => <IncidentCard incident={incident} muted={props.muted} />}</For>
		</div>
	);

	if (props.collapsible) {
		return (
			<Collapsible>
				<CollapsibleTrigger class="w-full flex items-center justify-between px-4 py-3 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors group">
					<div class="flex items-center gap-3">
						<div class={`p-1.5 rounded-md ${props.iconBg}`}>{props.icon}</div>
						<div class="text-left">
							<span class="font-medium text-foreground">{props.title}</span>
							<span class="ml-2 text-sm text-muted-foreground">({props.incidents.length})</span>
						</div>
					</div>
					<ChevronRight class="w-5 h-5 text-muted-foreground transition-transform group-data-[expanded]:rotate-90" />
				</CollapsibleTrigger>
				<CollapsibleContent class="overflow-hidden data-[expanded]:animate-collapsible-down data-[closed]:animate-collapsible-up">
					<div class="mt-3 pl-4 border-l-2 border-muted">{incidentsList()}</div>
				</CollapsibleContent>
			</Collapsible>
		);
	}

	return (
		<section>
			<div class="flex items-center gap-3 mb-4">
				<div class={`p-2 rounded-lg ${props.iconBg}`}>{props.icon}</div>
				<h2 class="text-xl font-semibold text-foreground">{props.title}</h2>
			</div>
			{incidentsList()}
		</section>
	);
}

function IncidentCard(props: { incident: ListIncidentsElement; muted?: boolean }) {
	const severity = () => getSeverity(props.incident.severity);

	return (
		<Link to="/incidents/$incidentId" params={{ incidentId: props.incident.id }} class="block">
			<Card class={`p-4 transition-all cursor-pointer ${props.muted ? "bg-muted/30 border-border/50 hover:bg-muted/50" : "bg-card hover:bg-muted/30"}`}>
				<div class="flex items-start justify-between gap-4">
					<div class="flex items-start gap-3 min-w-0 flex-1">
						<div class={`shrink-0 mt-0.5 ${props.muted ? "text-muted-foreground/50" : severity().color}`}>{severity().icon("sm")}</div>
						<div class="min-w-0 flex-1">
							<h2 class={`font-medium truncate ${props.muted ? "text-muted-foreground" : "text-foreground"}`}>{props.incident.title}</h2>
							<Show when={props.incident.description}>
								<p class={`text-sm mt-1 line-clamp-2 ${props.muted ? "text-muted-foreground/50" : "text-muted-foreground"}`}>{props.incident.description}</p>
							</Show>
						</div>
					</div>
					<div class="flex items-center gap-3 shrink-0">
						<span class={`text-sm ${props.muted ? "text-muted-foreground/50" : "text-muted-foreground"}`}>
							{new Date(props.incident.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
						</span>
						<ChevronRight class={`w-4 h-4 ${props.muted ? "text-muted-foreground/30" : "text-muted-foreground/50"}`} />
					</div>
				</div>
			</Card>
		</Link>
	);
}
