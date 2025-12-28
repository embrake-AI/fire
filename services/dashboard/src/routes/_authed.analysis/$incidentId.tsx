import { useQuery, useQueryClient } from "@tanstack/solid-query";
import { createFileRoute, Link } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { ArrowLeft, ChartColumn, Clock, FileText, Sparkles } from "lucide-solid";
import type { Accessor } from "solid-js";
import { createEffect, createMemo, createSignal, Index, Match, onCleanup, onMount, Show, Suspense, Switch } from "solid-js";
import { UserAvatar } from "~/components/SlackEntityPicker";
import { Timeline } from "~/components/Timeline";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { Tabs, TabsContent, TabsIndicator, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { getSeverity, getStatus } from "~/lib/incident-config";
import { computeIncidentMetrics, getAnalysisById, getIncidents, type IncidentAnalysis } from "~/lib/incidents";

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

export const Route = createFileRoute("/_authed/analysis/$incidentId")({
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
									<InsightsCard analysis={data} />
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
					<UserAvatar id={analysis().assignee} withName />
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

function InsightsCard(props: { analysis: Accessor<IncidentAnalysis> }) {
	const metrics = createMemo(() => computeIncidentMetrics(props.analysis()));
	const [tab, setTab] = createSignal<"summary" | "metrics">("summary");
	const [mounted, setMounted] = createSignal(false);

	let summaryEl: HTMLDivElement | undefined;
	let metricsEl: HTMLDivElement | undefined;
	let wrapEl: HTMLDivElement | undefined;

	const MIN_H = 120;
	const [h, setH] = createSignal<number>(MIN_H);

	const measure = () => {
		const el = tab() === "summary" ? summaryEl : metricsEl;
		if (!el) return;
		const next = Math.max(MIN_H, Math.ceil(el.scrollHeight));
		setH(next);
	};

	let ro: ResizeObserver | undefined;
	onMount(() => {
		requestAnimationFrame(() => {
			measure();
			setMounted(true);
		});

		ro = new ResizeObserver(() => requestAnimationFrame(measure));
		if (summaryEl) ro.observe(summaryEl);
		if (metricsEl) ro.observe(metricsEl);
	});

	onCleanup(() => ro?.disconnect());

	createEffect(() => {
		tab();
		requestAnimationFrame(measure);
	});

	return (
		<Tabs value={tab()} onChange={setTab}>
			<div class="flex items-center justify-between mb-3">
				<h3 class="text-lg font-semibold flex items-center gap-2">
					<Sparkles class="w-5 h-5 text-blue-500" />
					Insights
				</h3>

				<TabsList class="h-8">
					<TabsTrigger value="summary" class="text-xs px-3 py-1 h-7 gap-1.5">
						<Sparkles class="w-3.5 h-3.5" />
						Summary
					</TabsTrigger>

					<TabsTrigger value="metrics" class="text-xs px-3 py-1 h-7 gap-1.5">
						<ChartColumn class="w-3.5 h-3.5" />
						Metrics
					</TabsTrigger>

					<Show when={mounted()}>
						<TabsIndicator />
					</Show>
				</TabsList>
			</div>

			<Card class="border-l-4 border-l-blue-500">
				<CardContent class="py-5">
					{/* Animated height wrapper */}
					<div ref={wrapEl} class="overflow-hidden transition-[height] duration-200 ease-out" style={{ height: `${h()}px` }}>
						{/* Panels overlaid; wrapper animates height */}
						<div class="relative h-full">
							<TabsContent value="summary" class="mt-0 absolute inset-0" classList={{ "pointer-events-none opacity-0": tab() !== "summary" }}>
								<div class="h-full flex items-center justify-center">
									<div ref={summaryEl} class="w-full">
										<p class="text-muted-foreground leading-relaxed">{props.analysis().summary}</p>
									</div>
								</div>
							</TabsContent>

							<TabsContent value="metrics" class="mt-0 absolute inset-0" classList={{ "pointer-events-none opacity-0": tab() !== "metrics" }}>
								<div class="h-full flex items-center justify-center">
									<div ref={metricsEl} class="w-full">
										<div class="grid grid-cols-2 md:grid-cols-4 gap-4 justify-items-center">
											<MetricItem label="First Response" value={formatDurationMs(metrics().timeToFirstResponse)} description="Time until first message" />
											<MetricItem label="Assignee Response" value={formatDurationMs(metrics().timeToAssigneeResponse)} description="Time until assignee responded" />
											<MetricItem label="Time to Mitigate" value={formatDurationMs(metrics().timeToMitigate)} description="Time until status changed to mitigating" />
											<MetricItem label="Total Duration" value={formatDurationMs(metrics().totalDuration)} description="Total incident duration" />
										</div>
									</div>
								</div>
							</TabsContent>

							{/* Spacer keeps layout measurable even with absolute panels */}
							<div class="invisible">
								{tab() === "summary" ? (
									<div ref={summaryEl}>
										<p class="leading-relaxed">{props.analysis().summary}</p>
									</div>
								) : (
									<div ref={metricsEl} class="grid grid-cols-2 md:grid-cols-4 gap-4">
										<div />
										<div />
										<div />
										<div />
									</div>
								)}
							</div>
						</div>
					</div>
				</CardContent>
			</Card>
		</Tabs>
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
