import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createFileRoute, Link } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { ArrowLeft, ChartColumn, Clock, ExternalLink, FileText, LoaderCircle, Plus, Trash2 } from "lucide-solid";
import type { Accessor } from "solid-js";
import { createEffect, createMemo, createSignal, For, Index, Match, on, onCleanup, Show, Suspense, Switch } from "solid-js";
import { NotionIcon } from "~/components/icons/NotionIcon";
import { UserDisplay } from "~/components/MaybeUser";
import { Timeline } from "~/components/Timeline";
import { AutoSaveTextarea } from "~/components/ui/auto-save-textarea";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "~/components/ui/dialog";
import { Skeleton } from "~/components/ui/skeleton";
import { getSeverity, getStatus } from "~/lib/incident-config";
import {
	useCreateIncidentAction,
	useDeleteIncidentAction,
	useUpdateAnalysisImpact,
	useUpdateAnalysisRootCause,
	useUpdateAnalysisTimeline,
	useUpdateIncidentAction,
} from "~/lib/incidents/incident-analysis.hooks";
import { computeIncidentMetrics, getAnalysisById, getIncidents, type IncidentAction, type IncidentAnalysis, type IncidentTimelineItem } from "~/lib/incidents/incidents";
import { useIntegrations } from "~/lib/integrations/integrations.hooks";
import { exportToNotion, getNotionPages } from "~/lib/notion/notion-export";
import { useUserBySlackId } from "~/lib/users/users.hooks";

function AnalysisSkeleton() {
	return (
		<div class="space-y-6">
			<div class="space-y-4">
				<div class="flex items-start justify-between gap-4">
					<Skeleton class="h-9 w-120" />
					<Skeleton variant="circular" class="h-8 w-24" />
				</div>
				<div class="flex items-center gap-3">
					<Skeleton class="h-5 w-20" />
					<span class="text-muted-foreground/20">·</span>
					<Skeleton class="h-5 w-28" />
					<span class="text-muted-foreground/20">·</span>
					<Skeleton class="h-5 w-24" />
					<span class="text-muted-foreground/20">·</span>
					<Skeleton class="h-5 w-32" />
				</div>
			</div>

			<div>
				<div class="flex items-center justify-between mb-3">
					<div class="flex items-center gap-2">
						<Skeleton variant="circular" class="h-5 w-5" />
						<Skeleton class="h-6 w-16" />
					</div>
					<Skeleton variant="circular" class="h-8 w-40" />
				</div>
				<Card class="border-l-4 border-l-blue-500">
					<CardContent class="py-5" style={{ height: "120px" }}>
						<div class="space-y-2">
							<Skeleton variant="text" class="w-full" />
							<Skeleton variant="text" class="w-4/5" />
							<Skeleton variant="text" class="w-2/3" />
						</div>
					</CardContent>
				</Card>
			</div>

			<Card class="overflow-hidden">
				<CardHeader>
					<Skeleton class="h-6 w-28" />
				</CardHeader>
				<CardContent>
					<div class="space-y-6">
						<div class="flex gap-4">
							<Skeleton variant="circular" class="h-8 w-8 shrink-0" />
							<div class="flex-1 space-y-2">
								<Skeleton variant="text" class="w-48" />
								<Skeleton variant="text" class="w-full" />
							</div>
						</div>
						<Index each={Array.from({ length: 3 })}>
							{() => (
								<div class="flex gap-4">
									<Skeleton variant="circular" class="h-8 w-8 shrink-0" />
									<div class="flex-1 space-y-2">
										<Skeleton variant="text" class="w-36" />
										<Skeleton variant="text" class="w-3/4" />
									</div>
								</div>
							)}
						</Index>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}

export const Route = createFileRoute("/_authed/metrics/$incidentId")({
	component: AnalysisDetail,
});

function AnalysisDetail() {
	const params = Route.useParams();
	const getAnalysisByIdFn = useServerFn(getAnalysisById);
	const queryClient = useQueryClient();

	const analysisQuery = useQuery(() => ({
		queryKey: ["analysis", params().incidentId],
		queryFn: () => getAnalysisByIdFn({ data: { id: params().incidentId } }),
		staleTime: Infinity,
	}));

	const analysis = () => analysisQuery.data;

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
		<div class="flex-1 bg-background p-6 md:p-8">
			<div class="max-w-5xl mx-auto">
				<Link
					to="/"
					class="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-6"
					onMouseEnter={prefetchIncidents}
					onFocusIn={prefetchIncidents}
				>
					<ArrowLeft class="w-4 h-4" />
					Back to incidents
				</Link>

				<Suspense fallback={<AnalysisSkeleton />}>
					<Switch>
						<Match when={analysisQuery.isSuccess && analysisQuery.data === null}>
							<Card class="border-t-4 border-t-zinc-200">
								<CardContent class="py-12">
									<div class="text-center space-y-3">
										<h3 class="text-xl font-semibold text-foreground">Analysis Not Found</h3>
										<p class="text-muted-foreground max-w-sm mx-auto">We couldn't find the analysis for this incident. It might still be calculating or it doesn't exist.</p>
										<Link to="/" class="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 font-medium pt-2">
											<ArrowLeft class="w-4 h-4" />
											Go back to incidents
										</Link>
									</div>
								</CardContent>
							</Card>
						</Match>
						<Match when={analysis()}>
							{(data) => (
								<div class="space-y-6">
									<AnalysisHeader analysis={data} />
									<MetricsCard analysis={data} />
									<PostmortemCard analysis={data} />
									<Timeline events={data().events} />
								</div>
							)}
						</Match>
					</Switch>
				</Suspense>
			</div>
		</div>
	);
}

function AnalysisHeader(props: { analysis: Accessor<IncidentAnalysis> }) {
	const analysis = () => props.analysis();
	const severityConfig = () => getSeverity(analysis().severity);
	const status = getStatus("resolved");
	const user = useUserBySlackId(() => analysis().assignee);

	const formatDuration = () => {
		const start = new Date(analysis().createdAt);
		const end = new Date(analysis().resolvedAt);
		const durationMs = end.getTime() - start.getTime();
		const minutes = Math.floor(durationMs / 60000);
		const hours = Math.floor(minutes / 60);
		const days = Math.floor(hours / 24);

		if (days > 0) return `${days}d ${hours % 24}h`;
		if (hours > 0) return `${hours}h ${minutes % 60}m`;
		return `${minutes}m`;
	};

	return (
		<div class="space-y-4">
			<div class="flex items-start justify-between gap-4">
				<h1 class="text-3xl font-bold tracking-tight">{analysis().title}</h1>
				<Badge round class={`${status.bg} ${status.color} border-transparent h-8 px-3 text-sm shrink-0`}>
					<span class={`w-2 h-2 rounded-full mr-2 ${status.dot}`} />
					{status.label}
				</Badge>
			</div>
			<div class="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
				<div class="flex items-center gap-2">
					<div class={`w-2 h-2 rounded-full ${severityConfig().dot}`} />
					<span class="capitalize">{analysis().severity}</span>
				</div>

				<span class="text-muted-foreground/40">·</span>

				<div class="flex items-center gap-2">
					<UserDisplay user={user} withName />
				</div>

				<span class="text-muted-foreground/40">·</span>

				<div class="flex items-center gap-2">
					<Clock class="h-4 w-4" />
					<span>Duration: {formatDuration()}</span>
				</div>

				<span class="text-muted-foreground/40">·</span>

				<div class="flex items-center gap-2">
					<FileText class="h-4 w-4" />
					<span>
						Resolved{" "}
						{new Date(analysis().resolvedAt).toLocaleString(undefined, {
							month: "short",
							day: "numeric",
							hour: "2-digit",
							minute: "2-digit",
						})}
					</span>
				</div>
			</div>
		</div>
	);
}

function formatDurationMs(ms: number | null): string {
	if (ms === null) return "N/A";
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	if (days > 0) return `${days}d ${hours % 24}h`;
	if (hours > 0) return `${hours}h ${minutes % 60}m`;
	if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
	return `${seconds}s`;
}

function PostmortemCard(props: { analysis: Accessor<IncidentAnalysis> }) {
	const analysis = () => props.analysis();
	const integrationsQuery = useIntegrations({ type: "workspace" });
	const isNotionConnected = () => integrationsQuery.data?.some((i) => i.platform === "notion") ?? false;

	return (
		<Card>
			<CardHeader>
				<div class="flex items-center justify-between">
					<h3 class="text-lg font-semibold flex items-center gap-2">
						<FileText class="w-5 h-5 text-blue-500" />
						Post-mortem
					</h3>
					<Show when={isNotionConnected()}>
						<ExportToNotionDialog incidentId={analysis().id} title={analysis().title} />
					</Show>
				</div>
			</CardHeader>
			<CardContent>
				<div class="space-y-6">
					<EditableTimeline incidentId={analysis().id} timeline={analysis().timeline ?? []} />
					<EditableImpact incidentId={analysis().id} value={analysis().impact ?? ""} />
					<EditableRootCause incidentId={analysis().id} value={analysis().rootCause ?? ""} />
					<EditableActions incidentId={analysis().id} actions={analysis().actions ?? []} />
				</div>
			</CardContent>
		</Card>
	);
}

function ExportToNotionDialog(props: { incidentId: string; title: string }) {
	const [open, setOpen] = createSignal(false);
	const [selectedPageId, setSelectedPageId] = createSignal<string | null>(null);
	const [searchQuery, setSearchQuery] = createSignal("");
	const [exportedUrl, setExportedUrl] = createSignal<string | null>(null);

	const getNotionPagesFn = useServerFn(getNotionPages);
	const notionPagesQuery = useQuery(() => ({
		queryKey: ["notion-pages", searchQuery()],
		queryFn: () => getNotionPagesFn({ data: { query: searchQuery() } }),
		staleTime: 30_000,
		enabled: open(),
	}));

	const exportToNotionFn = useServerFn(exportToNotion);
	const exportMutation = useMutation(() => ({
		mutationFn: (data: { incidentId: string; parentPageId: string }) => exportToNotionFn({ data }),
		onSuccess: (result) => {
			setExportedUrl(result.url);
		},
	}));

	const handleExport = () => {
		const pageId = selectedPageId();
		if (!pageId) return;

		exportMutation.mutate({
			incidentId: props.incidentId,
			parentPageId: pageId,
		});
	};

	const handleOpenChange = (isOpen: boolean) => {
		setOpen(isOpen);
		if (!isOpen) {
			setSelectedPageId(null);
			setSearchQuery("");
			setExportedUrl(null);
		}
	};

	return (
		<Dialog open={open()} onOpenChange={handleOpenChange}>
			<DialogTrigger as={Button} variant="outline" size="sm" class="gap-2">
				<NotionIcon class="size-4" />
				Export to Notion
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Export to Notion</DialogTitle>
				</DialogHeader>
				<Show
					when={!exportedUrl()}
					fallback={
						<div class="space-y-4">
							<p class="text-sm text-muted-foreground">Post-mortem exported successfully.</p>
							<a href={exportedUrl()!} target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 font-medium">
								<ExternalLink class="w-4 h-4" />
								Open in Notion
							</a>
						</div>
					}
				>
					<div class="space-y-4">
						<p class="text-sm text-muted-foreground">Select a parent page where the post-mortem will be created.</p>
						<input
							type="text"
							placeholder="Search pages..."
							value={searchQuery()}
							onInput={(e) => setSearchQuery(e.currentTarget.value)}
							class="w-full px-3 py-2 border rounded-md text-sm"
						/>
						<div class="max-h-60 overflow-y-auto space-y-1 border rounded-md p-1">
							<Show when={notionPagesQuery.isLoading}>
								<div class="flex items-center justify-center py-4">
									<LoaderCircle class="w-5 h-5 animate-spin text-muted-foreground" />
								</div>
							</Show>
							<Show when={notionPagesQuery.data?.length === 0}>
								<p class="text-sm text-muted-foreground text-center py-4">No pages found. Make sure to share pages with the integration.</p>
							</Show>
							<For each={notionPagesQuery.data ?? []}>
								{(page) => (
									<button
										type="button"
										class={`w-full text-left px-3 py-2 rounded-md transition-colors text-sm ${selectedPageId() === page.id ? "bg-blue-100 text-blue-900" : "hover:bg-muted"}`}
										onClick={() => setSelectedPageId(page.id)}
									>
										<span class="mr-2">{page.icon || "\u{1F4C4}"}</span>
										{page.title}
									</button>
								)}
							</For>
						</div>
						<Button onClick={handleExport} disabled={!selectedPageId() || exportMutation.isPending} class="w-full">
							<Show when={exportMutation.isPending}>
								<LoaderCircle class="w-4 h-4 animate-spin mr-2" />
							</Show>
							Export
						</Button>
					</div>
				</Show>
			</DialogContent>
		</Dialog>
	);
}

function EditableImpact(props: { incidentId: string; value: string }) {
	const mutation = useUpdateAnalysisImpact(() => props.incidentId);

	return (
		<div class="space-y-2">
			<h4 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Impact</h4>
			<AutoSaveTextarea value={props.value} onSave={async (value) => void (await mutation.mutateAsync(value))} placeholder="Describe the impact..." rows={2} />
		</div>
	);
}

function EditableRootCause(props: { incidentId: string; value: string }) {
	const mutation = useUpdateAnalysisRootCause(() => props.incidentId);

	return (
		<div class="space-y-2">
			<h4 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Root cause</h4>
			<AutoSaveTextarea value={props.value} onSave={async (value) => void (await mutation.mutateAsync(value))} placeholder="Describe the root cause..." rows={2} />
		</div>
	);
}

function toDatetimeLocal(isoString: string): string {
	const date = new Date(isoString);
	if (Number.isNaN(date.getTime())) return "";
	const pad = (n: number) => n.toString().padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromDatetimeLocal(value: string): string {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function EditableTimeline(props: { incidentId: string; timeline: IncidentTimelineItem[] }) {
	const mutation = useUpdateAnalysisTimeline(() => props.incidentId);

	type TimelineEntry = IncidentTimelineItem & { localId: string };
	const [items, setItems] = createSignal<TimelineEntry[]>([]);
	let idCounter = 0;
	let saveTimer: ReturnType<typeof setTimeout> | undefined;

	const makeLocalId = () => `local-${idCounter++}`;

	// Initialize from props only when incidentId changes (not when timeline updates from server)
	createEffect(
		on(
			() => props.incidentId,
			() => {
				setItems(props.timeline.map((item) => ({ ...item, localId: makeLocalId() })));
			}
		)
	);

	const sortedItems = createMemo(() =>
		[...items()].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
	);

	const save = () => {
		clearTimeout(saveTimer);
		const payload = items().map(({ created_at, text }) => ({ created_at, text }));
		mutation.mutate(payload);
	};

	const debouncedSave = () => {
		clearTimeout(saveTimer);
		saveTimer = setTimeout(save, 500);
	};

	onCleanup(() => clearTimeout(saveTimer));

	const updateItem = (localId: string, field: "text" | "created_at", value: string) => {
		setItems((prev) => prev.map((item) => (item.localId === localId ? { ...item, [field]: value } : item)));
		debouncedSave();
	};

	const deleteItem = (localId: string) => {
		setItems((prev) => prev.filter((item) => item.localId !== localId));
		save();
	};

	const addItem = () => {
		setItems((prev) => [...prev, { localId: makeLocalId(), created_at: new Date().toISOString(), text: "" }]);
		save();
	};

	return (
		<div class="space-y-3">
			<div class="flex items-center justify-between">
				<h4 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Timeline</h4>
				<Button variant="ghost" size="sm" class="h-7 text-xs gap-1" onClick={addItem}>
					<Plus class="w-3.5 h-3.5" />
					Add entry
				</Button>
			</div>
			<Show when={sortedItems().length > 0} fallback={<p class="text-sm text-muted-foreground">No timeline entries</p>}>
				<div class="space-y-3">
					<For each={sortedItems()}>
						{(item) => (
							<div class="flex items-start gap-3 group">
								<input
									type="datetime-local"
									value={toDatetimeLocal(item.created_at)}
									onChange={(e) => updateItem(item.localId, "created_at", fromDatetimeLocal(e.currentTarget.value))}
									class="w-44 shrink-0 px-2 py-1.5 text-xs rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-blue-500"
								/>
								<input
									type="text"
									value={item.text}
									onInput={(e) => updateItem(item.localId, "text", e.currentTarget.value)}
									placeholder="What happened..."
									class="flex-1 px-2 py-1.5 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-blue-500"
								/>
								<Button
									variant="ghost"
									size="icon"
									class="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
									onClick={() => deleteItem(item.localId)}
								>
									<Trash2 class="w-4 h-4" />
								</Button>
							</div>
						)}
					</For>
				</div>
			</Show>
		</div>
	);
}

function EditableActions(props: { incidentId: string; actions: IncidentAction[] }) {
	const updateMutation = useUpdateIncidentAction(() => props.incidentId);
	const deleteMutation = useDeleteIncidentAction(() => props.incidentId);
	const createMutation = useCreateIncidentAction(() => props.incidentId);

	const addAction = () => {
		createMutation.mutate("");
	};

	return (
		<div class="space-y-3">
			<div class="flex items-center justify-between">
				<h4 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Actions</h4>
				<Button variant="ghost" size="sm" class="h-7 text-xs gap-1" onClick={addAction}>
					<Plus class="w-3.5 h-3.5" />
					Add action
				</Button>
			</div>
			<Show when={props.actions.length > 0} fallback={<p class="text-sm text-muted-foreground">No follow-up actions</p>}>
				<div class="space-y-3">
					<For each={props.actions}>
						{(action) => (
							<div class="flex items-start gap-2 group">
								<div class="flex-1">
									<AutoSaveTextarea
										value={action.description}
										onSave={async (value) => void (await updateMutation.mutateAsync({ id: action.id, description: value }))}
										placeholder="Describe the action..."
										rows={1}
									/>
								</div>
								<Button
									variant="ghost"
									size="icon"
									class="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
									onClick={() => deleteMutation.mutate(action.id)}
								>
									<Trash2 class="w-4 h-4" />
								</Button>
							</div>
						)}
					</For>
				</div>
			</Show>
		</div>
	);
}

function MetricsCard(props: { analysis: Accessor<IncidentAnalysis> }) {
	const metrics = createMemo(() => computeIncidentMetrics(props.analysis()));

	return (
		<div>
			<div class="flex items-center justify-between mb-3">
				<h3 class="text-lg font-semibold flex items-center gap-2">
					<ChartColumn class="w-5 h-5 text-blue-500" />
					Metrics
				</h3>
			</div>

			<Card class="border-l-4 border-l-blue-500">
				<CardContent class="py-5">
					<div class="grid grid-cols-2 md:grid-cols-4 gap-4 justify-items-center">
						<MetricItem label="First Response" value={formatDurationMs(metrics().timeToFirstResponse)} description="Time until first message" />
						<MetricItem label="Assignee Response" value={formatDurationMs(metrics().timeToAssigneeResponse)} description="Time until assignee responded" />
						<MetricItem label="Time to Mitigate" value={formatDurationMs(metrics().timeToMitigate)} description="Time until status changed to mitigating" />
						<MetricItem label="Total Duration" value={formatDurationMs(metrics().totalDuration)} description="Total incident duration" />
					</div>
				</CardContent>
			</Card>
		</div>
	);
}

function MetricItem(props: { label: string; value: string; description: string }) {
	return (
		<div class="space-y-1">
			<p class="text-xs text-muted-foreground">{props.label}</p>
			<p class="text-xl font-semibold text-foreground">{props.value}</p>
			<p class="text-xs text-muted-foreground/70">{props.description}</p>
		</div>
	);
}
