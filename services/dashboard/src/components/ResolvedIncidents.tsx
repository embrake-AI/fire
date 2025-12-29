import { useQuery } from "@tanstack/solid-query";
import { Link } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { ChevronRight, ShieldAlert } from "lucide-solid";
import { createEffect, createSignal, For, on, Show } from "solid-js";
import { Card } from "~/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible";
import { getSeverity } from "~/lib/incident-config";
import { getResolvedIncidents, type ResolvedIncident } from "~/lib/incidents/incidents";

export function ResolvedIncidents() {
	const getResolvedIncidentsFn = useServerFn(getResolvedIncidents);
	const [isOpen, setIsOpen] = createSignal(false);

	const resolvedQuery = useQuery(() => ({
		queryKey: ["resolved-incidents"],
		queryFn: getResolvedIncidentsFn,
		staleTime: 60_000,
	}));

	const resolvedIncidents = () => resolvedQuery.data ?? [];

	let wrapperEl!: HTMLDivElement;

	createEffect(
		on(isOpen, (open) => {
			const el = wrapperEl;
			if (!el) return;

			el.style.overflow = "hidden";
			el.style.willChange = "height";
			el.style.transition = "height 300ms ease";

			if (open) {
				// 0 -> scrollHeight -> auto
				el.style.height = "0px";
				requestAnimationFrame(() => {
					el.style.height = `${el.scrollHeight}px`;
				});

				const onEnd = (e: TransitionEvent) => {
					if (e.propertyName !== "height") return;
					el.style.height = "auto";
					el.removeEventListener("transitionend", onEnd);
				};
				el.addEventListener("transitionend", onEnd);
			} else {
				// IMPORTANT: freeze the current pixel height first (even if it was auto)
				const current = el.getBoundingClientRect().height;
				el.style.height = `${current}px`;

				// next frame: animate to 0
				requestAnimationFrame(() => {
					el.style.height = "0px";
				});
			}
		}),
	);

	return (
		<Show when={resolvedIncidents().length > 0}>
			<div class="mt-auto pt-12">
				<Collapsible open={isOpen()} onOpenChange={setIsOpen} forceMount>
					<CollapsibleTrigger class="w-full flex items-center justify-between px-4 py-3 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors group bg-muted/20 border border-border/50">
						<div class="flex items-center gap-3">
							<div class="p-1.5 rounded-md bg-muted">
								<ShieldAlert class="w-4 h-4 text-muted-foreground" />
							</div>
							<div class="text-left">
								<span class="font-medium text-foreground">Resolved Incidents</span>
								<span class="ml-2 text-sm text-muted-foreground">({resolvedIncidents().length})</span>
							</div>
						</div>
						<ChevronRight class="w-5 h-5 text-muted-foreground transition-transform duration-300" classList={{ "rotate-90": isOpen() }} />
					</CollapsibleTrigger>

					<CollapsibleContent>
						<div
							ref={wrapperEl}
							style={{
								height: "0px",
								overflow: "hidden",
							}}
							class="will-change-[height]"
						>
							<div class="mt-4 space-y-3 max-h-64 overflow-y-auto pr-2">
								<For each={resolvedIncidents()}>{(incident) => <ResolvedIncidentCard incident={incident} />}</For>
							</div>
						</div>
					</CollapsibleContent>
				</Collapsible>
			</div>
		</Show>
	);
}

function ResolvedIncidentCard(props: { incident: ResolvedIncident }) {
	const severity = () => getSeverity(props.incident.severity);

	return (
		<Link to="/analysis/$incidentId" params={{ incidentId: props.incident.id }} class="block">
			<Card class="p-4 transition-all cursor-pointer bg-muted/30 border-border/50 hover:bg-muted/50">
				<div class="flex items-start justify-between gap-4">
					<div class="flex items-start gap-3 min-w-0 flex-1">
						<div class="shrink-0 mt-0.5 text-muted-foreground/50">{severity().icon("sm")}</div>
						<div class="min-w-0 flex-1">
							<h2 class="font-medium truncate text-muted-foreground">{props.incident.title}</h2>
							<Show when={props.incident.description}>
								<p class="text-sm mt-1 line-clamp-2 text-muted-foreground/50">{props.incident.description}</p>
							</Show>
						</div>
					</div>
					<div class="flex items-center gap-3 shrink-0">
						<span class="text-sm text-muted-foreground/50">
							{new Date(props.incident.resolvedAt).toLocaleString(undefined, {
								month: "short",
								day: "numeric",
								hour: "2-digit",
								minute: "2-digit",
							})}
						</span>
						<ChevronRight class="w-4 h-4 text-muted-foreground/30" />
					</div>
				</div>
			</Card>
		</Link>
	);
}
