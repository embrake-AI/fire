import { useQuery, useQueryClient } from "@tanstack/solid-query";
import { createFileRoute, Link } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { ArrowLeft, ChartColumn, Clock, FileText, Plus, Trash2 } from "lucide-solid";
import type { Accessor } from "solid-js";
import { createMemo, For, Index, Match, Show, Suspense, Switch } from "solid-js";
import { UserDisplay } from "~/components/MaybeUser";
import { Timeline } from "~/components/Timeline";
import { AutoSaveTextarea } from "~/components/ui/auto-save-textarea";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
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

	return (
		<Card>
			<CardHeader>
				<div class="flex items-center justify-between">
					<h3 class="text-lg font-semibold flex items-center gap-2">
						<FileText class="w-5 h-5 text-blue-500" />
						Post-mortem
					</h3>
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

	const updateItem = (index: number, field: "text" | "created_at", value: string) => {
		const updated = [...props.timeline];
		updated[index] = { ...updated[index], [field]: value };
		mutation.mutate(updated);
	};

	const deleteItem = (index: number) => {
		mutation.mutate(props.timeline.filter((_, i) => i !== index));
	};

	const addItem = () => {
		mutation.mutate([...props.timeline, { created_at: new Date().toISOString(), text: "" }]);
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
			<Show when={props.timeline.length > 0} fallback={<p class="text-sm text-muted-foreground">No timeline entries</p>}>
				<div class="space-y-3">
					<For each={props.timeline}>
						{(item, index) => (
							<div class="flex items-start gap-3 group">
								<input
									type="datetime-local"
									value={toDatetimeLocal(item.created_at)}
									onChange={(e) => updateItem(index(), "created_at", fromDatetimeLocal(e.currentTarget.value))}
									class="w-44 shrink-0 px-2 py-1.5 text-xs rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-blue-500"
								/>
								<input
									type="text"
									value={item.text}
									onInput={(e) => updateItem(index(), "text", e.currentTarget.value)}
									placeholder="What happened..."
									class="flex-1 px-2 py-1.5 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-blue-500"
								/>
								<Button
									variant="ghost"
									size="icon"
									class="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
									onClick={() => deleteItem(index())}
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
							<div class="flex items-start gap-3 group">
								<span class="mt-3 h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" />
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
