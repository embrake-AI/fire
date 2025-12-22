import type { IS } from "@fire/common";
import { useQuery } from "@tanstack/solid-query";
import { createFileRoute, Link } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { ChevronRight, CircleCheck, Flame, ShieldAlert, Wrench } from "lucide-solid";
import type { JSX } from "solid-js";
import { createMemo, For, Show } from "solid-js";
import { Badge } from "~/components/ui/badge";
import { Card } from "~/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible";
import { getSeverity, getStatus } from "~/lib/incident-config";
import { getIncidents } from "~/lib/incidents";

export const Route = createFileRoute("/")({
	component: IncidentsList,
	loader: ({ context }) =>
		context.queryClient.ensureQueryData({
			queryKey: ["incidents"],
			queryFn: () => getIncidents(),
		}),
});

function IncidentsList() {
	const getIncidentsFn = useServerFn(getIncidents);
	const incidentsQuery = useQuery(() => ({
		queryKey: ["incidents"],
		queryFn: getIncidentsFn,
		refetchInterval: 15_000,
	}));
	const incidents = () => incidentsQuery.data ?? [];

	const openIncidents = createMemo(() => incidents().filter((inc) => inc.status === "open"));
	const mitigatingIncidents = createMemo(() => incidents().filter((inc) => inc.status === "mitigating"));
	const resolvedIncidents = createMemo(() => incidents().filter((inc) => inc.status === "resolved"));

	const OpenIncidentsSection = (): JSX.Element => (
		<IncidentSection
			icon={<Flame class="w-5 h-5 text-red-600" />}
			iconBg="bg-red-100"
			title="Active Incidents"
			incidents={openIncidents()}
			cardVariant="prominent"
			wrapperClass="p-5 space-y-5 bg-red-50/50 border-red-200/60"
		/>
	);

	const MitigatingIncidentsSection = (): JSX.Element => (
		<IncidentSection
			icon={<Wrench class="w-5 h-5 text-amber-600" />}
			iconBg="bg-amber-100"
			title="Being Mitigated"
			incidents={mitigatingIncidents()}
			wrapperClass="p-5 space-y-5 bg-amber-50/50 border-amber-200/60"
		/>
	);

	const ResolvedIncidentsSection = (): JSX.Element => (
		<IncidentSection
			icon={<ShieldAlert class="w-4 h-4 text-muted-foreground" />}
			iconBg="bg-muted"
			title="Resolved Incidents"
			incidents={resolvedIncidents()}
			cardVariant="muted"
			collapsible
		/>
	);

	const openAndMitigatingIncidents = () => openIncidents().length > 0 && mitigatingIncidents().length > 0;
	const onlyMitigatingIncidents = () => mitigatingIncidents().length > 0 && openIncidents().length === 0;
	const noIncidents = () => openIncidents().length === 0 && mitigatingIncidents().length === 0 && resolvedIncidents().length === 0;

	return (
		<div class="flex-1 bg-background p-6 md:p-8">
			<div class="max-w-4xl mx-auto space-y-8">
				<Show when={noIncidents()}>
					<NoIncidents />
				</Show>

				<Show when={onlyMitigatingIncidents()}>
					<MitigatingIncidentsSection />
				</Show>

				<Show when={openIncidents().length > 0}>
					<OpenIncidentsSection />
				</Show>

				<Show when={openAndMitigatingIncidents()}>
					<MitigatingIncidentsSection />
				</Show>

				<Show when={resolvedIncidents().length > 0}>
					<ResolvedIncidentsSection />
				</Show>
			</div>
		</div>
	);
}

function NoIncidents() {
	return (
		<section class="flex flex-col items-center justify-center py-16 px-6">
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

function IncidentSection(props: {
	icon: JSX.Element;
	iconBg: string;
	title: string;
	incidents: IS[];
	cardVariant?: "prominent" | "default" | "muted";
	wrapperClass?: string;
	collapsible?: boolean;
}) {
	const incidentsList = () => (
		<div class="space-y-5">
			<For each={props.incidents}>{(incident) => <IncidentCard incident={incident} prominent={props.cardVariant === "prominent"} muted={props.cardVariant === "muted"} />}</For>
		</div>
	);

	const content = () => (
		<Show when={props.wrapperClass} fallback={incidentsList()}>
			<Card class={props.wrapperClass}>{incidentsList()}</Card>
		</Show>
	);

	// Collapsible variant
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
					<div class="mt-3 pl-4 border-l-2 border-muted">{content()}</div>
				</CollapsibleContent>
			</Collapsible>
		);
	}

	// Standard variant
	return (
		<section>
			<div class="flex items-center gap-3 mb-4">
				<div class={`p-2 rounded-lg ${props.iconBg}`}>{props.icon}</div>
				<div>
					<h2 class="text-xl font-semibold text-foreground">{props.title}</h2>
				</div>
			</div>
			{content()}
		</section>
	);
}

function IncidentCard(props: { incident: IS; prominent?: boolean; muted?: boolean }) {
	const severity = () => getSeverity(props.incident.severity);
	const status = () => getStatus(props.incident.status);

	const cardClasses = () => {
		if (props.muted) {
			return "bg-muted/30 border-border/50 hover:bg-muted/50";
		}
		if (props.prominent) {
			return `${severity().bg} ${severity().border} hover:shadow-lg shadow-sm`;
		}
		return `bg-card hover:shadow-md ${severity().border}`;
	};

	return (
		<Link to="/incidents/$incidentId" params={{ incidentId: props.incident.id }} class="block">
			<Card class={`p-4 transition-all cursor-pointer ${cardClasses()}`}>
				<div class="flex items-start gap-4">
					<div class={`mt-0.5 ${props.muted ? "text-muted-foreground" : severity().color}`}>{severity().icon("sm")}</div>
					<div class="flex-1 min-w-0">
						<div class="flex items-center gap-3 mb-1 flex-wrap">
							<h2 class={`text-lg font-medium truncate ${props.muted ? "text-muted-foreground" : "text-foreground"}`}>{props.incident.prompt}</h2>
							<Badge variant="outline" round class={props.muted ? "border-muted-foreground/40 text-muted-foreground" : `${status().bg} ${status().color} border-transparent`}>
								<span class={`w-1.5 h-1.5 rounded-full mr-1.5 ${props.muted ? "bg-muted-foreground/40" : status().dot}`} />
								{status().label}
							</Badge>
						</div>
						<p class={`text-sm ${props.muted ? "text-muted-foreground/70" : "text-muted-foreground"}`}>
							{props.incident.id} · {new Date(props.incident.createdAt).toLocaleString()}
						</p>
					</div>
				</div>
			</Card>
		</Link>
	);
}
