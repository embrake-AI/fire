import type { DateValue } from "@ark-ui/solid/date-picker";
import { useQuery } from "@tanstack/solid-query";
import { createFileRoute } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { endOfDay, parse, startOfDay } from "date-fns";
import { Calendar, ChartColumn, Check, Copy, Layers, Target, Users } from "lucide-solid";
import { createMemo, createSignal, For, Show, Suspense } from "solid-js";
import { SlackAvatar } from "~/components/SlackEntityPicker";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { DateRangePicker } from "~/components/ui/date-range-picker";
import { Skeleton } from "~/components/ui/skeleton";
import { Tabs, TabsIndicator, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { getMetrics } from "~/lib/incidents/incidents";

export const Route = createFileRoute("/_authed/analysis/")({
	component: AnalysisDashboard,
});

function AnalysisDashboard() {
	const [range, setRange] = createSignal<DateValue[]>([]);
	const [grouping, setGrouping] = createSignal("assignee");

	const getMetricsFn = useServerFn(getMetrics);

	const metricsQuery = useQuery(() => ({
		queryKey: ["metrics", range()[0]?.toString(), range()[1]?.toString()],
		queryFn: () => {
			const fromStr = range()[0]?.toString();
			const toStr = range()[1]?.toString();
			if (!fromStr || !toStr) return [];

			const fromDate = startOfDay(parse(fromStr, "yyyy-MM-dd", new Date()));
			const toDate = endOfDay(parse(toStr, "yyyy-MM-dd", new Date()));
			return getMetricsFn({
				data: {
					from: fromDate.toISOString(),
					to: toDate.toISOString(),
				},
			});
		},
		staleTime: 60_000,
		placeholderData: (prev) => prev,
	}));

	const incidents = () => metricsQuery.data ?? [];

	const groupedData = createMemo(() => {
		const data = incidents();
		const groups: Record<string, { count: number; totalDuration: number; timeToFirstResponse: number; resolvedCount: number; label: string }> = {};

		for (const incident of data) {
			let groupKey = "unknown";
			let groupLabel = "Unknown";
			if (grouping() === "assignee") {
				const slackUserId = incident.assignee.userIntegrations.find((ui) => ui.platform === "slack")?.userId ?? "unknown";
				groupKey = slackUserId;
				groupLabel = slackUserId;
			} else if (grouping() === "entryPoint") {
				groupKey = incident.entryPointId ?? "unknown";
				groupLabel = incident.entryPointPrompt ?? "Generic/Unknown";
			} else if (grouping() === "rotation") {
				groupKey = incident.rotationId ?? "none";
				groupLabel = incident.rotationName ?? (incident.rotationId ? "Unknown Rotation" : "No Rotation");
			}

			if (!groups[groupKey]) {
				groups[groupKey] = { count: 0, totalDuration: 0, timeToFirstResponse: 0, resolvedCount: 0, label: groupLabel };
			}

			const g = groups[groupKey];
			g.count++;
			if (incident.metrics.totalDuration !== null) {
				g.totalDuration += incident.metrics.totalDuration;
				g.resolvedCount++;
			}
			if (incident.metrics.timeToFirstResponse !== null) {
				g.timeToFirstResponse += incident.metrics.timeToFirstResponse;
			}
		}

		return Object.entries(groups)
			.map(([key, stats]) => ({
				key,
				label: stats.label,
				count: stats.count,
				avgDuration: stats.resolvedCount > 0 ? stats.totalDuration / stats.resolvedCount : 0,
				avgResponse: stats.count > 0 ? stats.timeToFirstResponse / stats.count : 0,
			}))
			.sort((a, b) => b.count - a.count);
	});

	const formatDuration = (ms: number) => {
		if (ms === 0) return "N/A";
		const minutes = Math.floor(ms / 60000);
		const hours = Math.floor(minutes / 60);
		if (hours > 0) return `${hours}h ${minutes % 60}m`;
		return `${minutes}m`;
	};

	return (
		<div class="flex-1 bg-background p-6 md:p-8 overflow-y-auto">
			<div class="max-w-6xl mx-auto space-y-8">
				<div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
					<div>
						<h1 class="text-3xl font-bold tracking-tight">Analysis & Metrics</h1>
						<p class="text-muted-foreground">Visualize incident trends and response performance.</p>
					</div>

					<div class="flex items-center gap-3">
						<CopyApiUrlButton range={range()} />
					</div>
				</div>

				<Filters range={range()} setRange={setRange} />

				<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
					<MetricSummaryCard title="Total Incidents" value={incidents().length} icon={<ChartColumn class="w-5 h-5 text-blue-500" />} />
					<MetricSummaryCard
						title="Avg. Time to Resolve"
						value={formatDuration(
							incidents().reduce((acc, inc) => acc + (inc.metrics.totalDuration ?? 0), 0) / (incidents().filter((i) => i.metrics.totalDuration !== null).length || 1),
						)}
						icon={<Target class="w-5 h-5 text-emerald-500" />}
					/>
				</div>

				<Tabs value={grouping()} onChange={(v) => setGrouping(v)}>
					<div class="flex items-center justify-between mb-4">
						<h2 class="text-xl font-semibold">Grouping by {grouping()}</h2>
						<TabsList>
							<TabsTrigger value="assignee" class="gap-2">
								<Users class="w-4 h-4" />
								Assignee
							</TabsTrigger>
							<TabsTrigger value="entryPoint" class="gap-2">
								<Layers class="w-4 h-4" />
								Entry Point
							</TabsTrigger>
							<TabsTrigger value="rotation" class="gap-2">
								<Target class="w-4 h-4" />
								Rotation
							</TabsTrigger>
							<TabsIndicator />
						</TabsList>
					</div>

					<Suspense fallback={<MetricsSkeleton />}>
						<div class="grid grid-cols-1 gap-4">
							<For each={groupedData()}>
								{(item) => (
									<Card class="hover:bg-muted/30 transition-colors">
										<CardContent class="p-4 flex items-center justify-between">
											<div class="flex items-center gap-4">
												<Show
													when={grouping() === "assignee"}
													fallback={
														<div class="p-2 bg-muted rounded-full">
															<Target class="w-5 h-5 text-muted-foreground" />
														</div>
													}
												>
													<SlackAvatar id={item.key} withName />
												</Show>
												<Show when={grouping() !== "assignee"}>
													<div>
														<p class="font-medium">{item.label}</p>
														<p class="text-xs text-muted-foreground">{grouping() === "entryPoint" ? "Entry Point" : "Rotation"}</p>
													</div>
												</Show>
											</div>

											<div class="flex items-center gap-8 text-sm">
												<div class="text-center">
													<p class="text-muted-foreground text-xs mb-0.5">Incidents</p>
													<p class="font-semibold">{item.count}</p>
												</div>
												<div class="text-center">
													<p class="text-muted-foreground text-xs mb-0.5">Avg. Resolution</p>
													<p class="font-semibold">{formatDuration(item.avgDuration)}</p>
												</div>
												<div class="text-center">
													<p class="text-muted-foreground text-xs mb-0.5">Avg. Response</p>
													<p class="font-semibold">{formatDuration(item.avgResponse)}</p>
												</div>
											</div>
										</CardContent>
									</Card>
								)}
							</For>

							<Show when={groupedData().length === 0}>
								<div class="py-12 text-center border rounded-lg border-dashed">
									<p class="text-muted-foreground">No data available for the selected period.</p>
								</div>
							</Show>
						</div>
					</Suspense>
				</Tabs>
			</div>
		</div>
	);
}

function Filters(props: { range: DateValue[]; setRange: (v: DateValue[]) => void }) {
	return (
		<Card>
			<CardContent class="p-4">
				<div class="flex flex-wrap items-center gap-6">
					<div class="flex items-center gap-2">
						<Calendar class="w-4 h-4 text-muted-foreground" />
						<span class="text-sm font-medium">Period:</span>
						<DateRangePicker value={props.range} onValueChange={props.setRange} defaultPreset="thisWeek" />
					</div>
				</div>
			</CardContent>
		</Card>
	);
}

function MetricSummaryCard(props: { title: string; value: string | number; icon: import("solid-js").JSX.Element }) {
	return (
		<Card>
			<CardHeader class="flex flex-row items-center justify-between pb-2">
				<CardTitle class="text-sm font-medium text-muted-foreground">{props.title}</CardTitle>
				{props.icon}
			</CardHeader>
			<CardContent>
				<div class="text-2xl font-bold">{props.value}</div>
			</CardContent>
		</Card>
	);
}

function CopyApiUrlButton(props: { range: DateValue[] }) {
	const [copied, setCopied] = createSignal(false);

	const handleCopy = () => {
		const fromStr = props.range[0]?.toString();
		const toStr = props.range[1]?.toString();
		if (!fromStr || !toStr) return;

		const fromDate = startOfDay(parse(fromStr, "yyyy-MM-dd", new Date()));
		const toDate = endOfDay(parse(toStr, "yyyy-MM-dd", new Date()));

		const url = new URL("/api/metrics", window.location.origin);
		url.searchParams.set("from", fromDate.toISOString());
		url.searchParams.set("to", toDate.toISOString());

		void navigator.clipboard.writeText(url.toString());
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<Button variant="outline" size="sm" onClick={handleCopy} class="gap-2">
			<Show when={copied()} fallback={<Copy class="w-4 h-4" />}>
				<Check class="w-4 h-4 text-emerald-600" />
			</Show>
			{copied() ? "Copied!" : "Copy API URL"}
		</Button>
	);
}

function MetricsSkeleton() {
	return (
		<div class="space-y-4">
			<For each={Array.from({ length: 3 })}>
				{() => (
					<Card>
						<CardContent class="p-4 flex items-center justify-between">
							<div class="flex items-center gap-4">
								<Skeleton variant="circular" class="w-10 h-10" />
								<div class="space-y-2">
									<Skeleton class="h-4 w-32" />
									<Skeleton class="h-3 w-20" />
								</div>
							</div>
							<div class="flex gap-8">
								<Skeleton class="h-8 w-16" />
								<Skeleton class="h-8 w-16" />
								<Skeleton class="h-8 w-16" />
							</div>
						</CardContent>
					</Card>
				)}
			</For>
		</div>
	);
}
