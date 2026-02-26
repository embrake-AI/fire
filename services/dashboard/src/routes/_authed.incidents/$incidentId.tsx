import { useQuery, useQueryClient } from "@tanstack/solid-query";
import { createFileRoute, Link } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { ArrowLeft } from "lucide-solid";
import { createEffect, createMemo, createSignal, Show } from "solid-js";
import { IncidentAffectionSection } from "~/components/incidents/IncidentAffectionSection";
import { IncidentHeader } from "~/components/incidents/IncidentHeader";
import { SlackMessageInput } from "~/components/SlackMessageInput";
import { Timeline } from "~/components/Timeline";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { Tabs, TabsContent, TabsIndicator, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { requireRoutePermission } from "~/lib/auth/route-guards";
import { runDemoAware } from "~/lib/demo/runtime";
import { getIncidentByIdDemo, getIncidentsDemo } from "~/lib/demo/store";
import { getIncidentById, getIncidents } from "~/lib/incidents/incidents";

function IncidentSkeleton() {
	return (
		<div class="space-y-6">
			<div class="space-y-4">
				<div class="flex items-start justify-between gap-4">
					<Skeleton class="h-9 w-120" />
					<Skeleton variant="circular" class="h-8 w-24" />
				</div>
				<div class="flex items-center gap-3">
					<Skeleton class="h-8 w-32" />
					<span class="text-muted-foreground/20">·</span>
					<Skeleton class="h-8 w-36" />
				</div>
			</div>

			<Card class="overflow-hidden">
				<CardHeader>
					<Skeleton class="h-6 w-28" />
				</CardHeader>
				<CardContent>
					<div
						class="space-y-6"
						style={{
							"mask-image": "linear-gradient(to bottom, black 0%, black 40%, transparent 100%)",
							"-webkit-mask-image": "linear-gradient(to bottom, black 0%, black 40%, transparent 100%)",
						}}
					>
						<div class="flex gap-4">
							<Skeleton variant="circular" class="h-8 w-8 shrink-0" />
							<div class="flex-1 space-y-2">
								<Skeleton variant="text" class="w-48" />
								<Skeleton variant="text" class="w-full" />
							</div>
						</div>
						<div class="flex gap-4">
							<Skeleton variant="circular" class="h-8 w-8 shrink-0" />
							<div class="flex-1 space-y-2">
								<Skeleton variant="text" class="w-36" />
								<Skeleton variant="text" class="w-3/4" />
							</div>
						</div>
						<div class="flex gap-4">
							<Skeleton variant="circular" class="h-8 w-8 shrink-0" />
							<div class="flex-1 space-y-2">
								<Skeleton variant="text" class="w-52" />
								<Skeleton variant="text" class="w-2/3" />
							</div>
						</div>
						<div class="flex gap-4">
							<Skeleton variant="circular" class="h-8 w-8 shrink-0" />
							<div class="flex-1 space-y-2">
								<Skeleton variant="text" class="w-40" />
							</div>
						</div>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}

export const Route = createFileRoute("/_authed/incidents/$incidentId")({
	beforeLoad: requireRoutePermission("incident.read"),
	component: IncidentDetail,
});

function IncidentDetail() {
	const params = Route.useParams();
	const navigate = Route.useNavigate();
	const queryClient = useQueryClient();

	const getIncidentByIdFn = useServerFn(getIncidentById);
	const incidentQuery = useQuery(() => ({
		queryKey: ["incident", params().incidentId],
		queryFn: () =>
			runDemoAware({
				demo: () => getIncidentByIdDemo({ id: params().incidentId }),
				remote: () => getIncidentByIdFn({ data: { id: params().incidentId } }),
			}),
		staleTime: Infinity,
		refetchInterval: 5_000,
	}));
	const incident = () => incidentQuery.data;
	const hasSlackContext = createMemo(() => !!incident()?.context?.thread && !!incident()?.context?.channel);
	const [activeTab, setActiveTab] = createSignal<"updates" | "timeline">("timeline");

	createEffect(() => {
		if (incidentQuery.data?.error === "NOT_FOUND") {
			navigate({ to: "/metrics/$incidentId", params: { incidentId: params().incidentId } });
		}
	});

	const getIncidentsFn = useServerFn(getIncidents);
	const prefetchIncidents = () => {
		const state = queryClient.getQueryState(["incidents"]);
		if (state?.status === "success" && !state.isInvalidated) {
			return;
		}
		void queryClient.prefetchQuery({
			queryKey: ["incidents"],
			queryFn: () =>
				runDemoAware({
					demo: () => getIncidentsDemo(),
					remote: () => getIncidentsFn(),
				}),
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

				<Show when={!incidentQuery.isLoading} fallback={<IncidentSkeleton />}>
					<Show when={incident()?.state}>
						{(state) => (
							<div class="space-y-6">
								<IncidentHeader incident={state} />
								<Tabs value={activeTab()} onChange={(value) => setActiveTab(value as "updates" | "timeline")}>
									<TabsList class="h-9">
										<TabsTrigger value="timeline" class="text-xs px-3 py-1 h-8 gap-2">
											Timeline
										</TabsTrigger>
										<TabsTrigger value="updates" class="text-xs px-3 py-1 h-8 gap-2">
											Status page updates
										</TabsTrigger>
										<TabsIndicator />
									</TabsList>
									<TabsContent value="updates">
										<IncidentAffectionSection incidentId={state().id} incidentStatus={state().status} />
									</TabsContent>
									<TabsContent value="timeline">
										<Show when={incident()?.events}>{(events) => <Timeline events={events()} />}</Show>
										<Show when={incident()?.events}>{(_) => <SlackMessageInput incidentId={state().id} hasSlackContext={hasSlackContext()} />}</Show>
									</TabsContent>
								</Tabs>
							</div>
						)}
					</Show>
				</Show>
			</div>
		</div>
	);
}
