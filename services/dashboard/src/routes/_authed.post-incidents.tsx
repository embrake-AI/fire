import { useQuery } from "@tanstack/solid-query";
import { createFileRoute, Link } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { Check, ChevronDown, ChevronRight, CircleCheck, Filter, Search, ShieldAlert, X } from "lucide-solid";
import { createMemo, createSignal, For, type JSX, Show, Suspense } from "solid-js";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { requireRoutePermission } from "~/lib/auth/route-guards";
import { runDemoAware } from "~/lib/demo/runtime";
import { getResolvedIncidentsDemo } from "~/lib/demo/store";
import { getSeverity, getStatus, severityConfig, statusConfig } from "~/lib/incident-config";
import { getResolvedIncidents, type ResolvedIncident } from "~/lib/incidents/incidents";
import { parseArrayOf, parseStringArray, useFilterParams } from "~/lib/useFilterParams";
import { useSlackUsers } from "~/lib/useSlackUsers";

const SEVERITIES = ["high", "medium", "low"] as const;
const TERMINAL_STATUSES = ["resolved", "declined"] as const;
const FILTER_SCHEMA = {
	severity: parseArrayOf(SEVERITIES),
	status: parseArrayOf(TERMINAL_STATUSES),
	assignee: parseStringArray,
};

export const Route = createFileRoute("/_authed/post-incidents")({
	beforeLoad: requireRoutePermission("metrics.read"),
	component: PostIncidentsPage,
	validateSearch: (search: Record<string, unknown>) => ({
		severity: FILTER_SCHEMA.severity(search.severity),
		status: FILTER_SCHEMA.status(search.status),
		assignee: FILTER_SCHEMA.assignee(search.assignee),
	}),
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

	const filters = useFilterParams(Route, FILTER_SCHEMA);

	const severityFilter = filters.get("severity");
	const statusFilter = filters.get("status");
	const assigneeFilter = filters.get("assignee");

	const slackUsersQuery = useSlackUsers();

	const resolveUserName = (id: string) => {
		const slackUser = slackUsersQuery.data?.find((u) => u.id === id);
		return slackUser?.name ?? id;
	};

	const assigneeOptions = createMemo(() => {
		const ids = [...new Set(resolvedIncidents().map((inc) => inc.assignee))];
		return ids.map((id) => ({ value: id, label: resolveUserName(id) })).sort((a, b) => a.label.localeCompare(b.label));
	});

	const [search, setSearch] = createSignal("");

	const filtered = createMemo(() => {
		let base = resolvedIncidents();

		const st = statusFilter();
		if (st) {
			base = base.filter((inc) => st.includes(inc.terminalStatus));
		} else {
			base = base.filter((inc) => inc.terminalStatus !== "declined");
		}

		const sev = severityFilter();
		if (sev) {
			base = base.filter((inc) => sev.includes(inc.severity));
		}

		const assignees = assigneeFilter();
		if (assignees) {
			base = base.filter((inc) => assignees.includes(inc.assignee));
		}

		const q = search().toLowerCase().trim();
		if (q) {
			base = base.filter((inc) => inc.title.toLowerCase().includes(q) || inc.description?.toLowerCase().includes(q) || inc.declineReason?.toLowerCase().includes(q));
		}

		return base;
	});

	return (
		<Show when={resolvedIncidents().length > 0} fallback={<NoResolvedIncidents />}>
			<div class="space-y-4">
				<div class="flex items-center gap-3 flex-wrap">
					<div class="relative max-w-xs">
						<Search class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
						<Input type="text" placeholder="Search incidents..." value={search()} onInput={(e) => setSearch(e.currentTarget.value)} class="pl-9" />
					</div>

					<FilterBar filters={filters} assigneeOptions={assigneeOptions()} />

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

type Filters = ReturnType<typeof useFilterParams<typeof FILTER_SCHEMA>>;

type FilterKey = "severity" | "status" | "assignee";
type FilterOption = { value: string; label: string; color?: string };

const FILTER_DEFS: { key: FilterKey; label: string }[] = [
	{ key: "severity", label: "Severity" },
	{ key: "status", label: "Status" },
	{ key: "assignee", label: "Assignee" },
];

function FilterBar(props: { filters: Filters; assigneeOptions: FilterOption[] }) {
	const [openPill, setOpenPill] = createSignal<FilterKey | null>(null);

	const availableFilters = createMemo(() => FILTER_DEFS.filter((def) => !props.filters.get(def.key)()));

	function addFilter(key: FilterKey) {
		setOpenPill(key);
	}

	return (
		<div class="flex items-center gap-2">
			<Show when={availableFilters().length > 0}>
				<Popover>
					<PopoverTrigger
						as={(triggerProps: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
							<Button variant="outline" size="sm" {...triggerProps}>
								<Filter class="h-4 w-4 mr-1.5" />
								Filters
							</Button>
						)}
					/>
					<PopoverContent class="w-44 p-1">
						<For each={availableFilters()}>
							{(def) => (
								<button
									type="button"
									class="flex w-full items-center rounded-md px-3 py-2 text-sm hover:bg-muted transition-colors cursor-pointer"
									onClick={() => addFilter(def.key)}
								>
									{def.label}
								</button>
							)}
						</For>
					</PopoverContent>
				</Popover>
			</Show>

			<For each={FILTER_DEFS.filter((def) => props.filters.get(def.key)() || openPill() === def.key)}>
				{(def) => (
					<FilterPill
						def={def}
						filters={props.filters}
						options={getOptionsForKey(def.key, props.assigneeOptions)}
						autoOpen={openPill() === def.key}
						onOpened={() => {
							if (openPill() === def.key) setOpenPill(null);
						}}
						onRemove={() => {
							if (openPill() === def.key) setOpenPill(null);
						}}
					/>
				)}
			</For>
		</div>
	);
}

function getOptionsForKey(key: FilterKey, assigneeOptions: FilterOption[]): FilterOption[] {
	if (key === "severity") return SEVERITIES.map((s) => ({ value: s, label: severityConfig[s].label, color: severityConfig[s].color }));
	if (key === "status") return TERMINAL_STATUSES.map((s) => ({ value: s, label: statusConfig[s].label, color: statusConfig[s].color }));
	return assigneeOptions;
}

function FilterPill(props: { def: { key: FilterKey; label: string }; filters: Filters; options: FilterOption[]; autoOpen: boolean; onOpened: () => void; onRemove: () => void }) {
	const values = createMemo<string[] | undefined>(() => props.filters.get(props.def.key)());

	function toggle(value: string) {
		const current = values() ?? [];
		const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
		if (next.length === 0) props.filters.clear(props.def.key);
		else props.filters.set(props.def.key, next);
	}

	function remove() {
		props.filters.clear(props.def.key);
		props.onRemove();
	}

	const displayLabel = createMemo(() => {
		const v = values();
		if (!v || v.length === 0) return null;
		const optMap = new Map(props.options.map((o) => [o.value, o.label]));
		return v.map((val) => optMap.get(val) ?? val).join(", ");
	});

	return (
		<Popover
			defaultOpen={props.autoOpen}
			onOpenChange={(open) => {
				if (open && props.autoOpen) props.onOpened();
			}}
		>
			<div class="inline-flex items-center rounded-md border bg-muted/50 text-xs font-medium text-foreground">
				<PopoverTrigger
					as={(triggerProps: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
						<button type="button" class="inline-flex items-center gap-1 px-2.5 py-1 hover:bg-muted transition-colors cursor-pointer rounded-l-md" {...triggerProps}>
							<span class="text-muted-foreground">{props.def.label}:</span>
							<Show when={displayLabel()} fallback={<span class="text-muted-foreground/60">select...</span>}>
								<span>{displayLabel()}</span>
							</Show>
							<ChevronDown class="h-3 w-3 text-muted-foreground ml-0.5" />
						</button>
					)}
				/>
				<button
					type="button"
					class="px-1.5 py-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer rounded-r-md border-l"
					onClick={remove}
				>
					<X class="h-3 w-3" />
				</button>
			</div>
			<PopoverContent class="w-48 p-1">
				<For each={props.options}>
					{(opt) => {
						const isActive = () => values()?.includes(opt.value) ?? false;
						return (
							<button
								type="button"
								class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted transition-colors cursor-pointer"
								onClick={() => toggle(opt.value)}
							>
								<div class={`flex h-4 w-4 items-center justify-center rounded border ${isActive() ? "border-primary bg-primary" : "border-muted-foreground/30"}`}>
									<Show when={isActive()}>
										<Check class="h-3 w-3 text-primary-foreground" />
									</Show>
								</div>
								<span class={opt.color ?? "text-foreground"}>{opt.label}</span>
							</button>
						);
					}}
				</For>
			</PopoverContent>
		</Popover>
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
	const status = () => getStatus(props.incident.terminalStatus);
	const isDeclined = () => props.incident.terminalStatus === "declined";

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
							<Show when={isDeclined() && props.incident.declineReason}>
								<p class="mt-1 line-clamp-2 text-sm text-muted-foreground">
									<span class="font-medium text-foreground">Decline reason:</span> {props.incident.declineReason}
								</p>
							</Show>
						</div>
					</div>
					<div class="flex shrink-0 items-center gap-3">
						<Badge class={`${status().bg} ${status().color} border-transparent`}>{status().label}</Badge>
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
