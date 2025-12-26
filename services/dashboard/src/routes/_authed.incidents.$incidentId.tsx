import type { IS } from "@fire/common";
import { useQuery, useQueryClient } from "@tanstack/solid-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { ArrowLeft, Clock, Monitor, User } from "lucide-solid";
import type { Accessor, Component } from "solid-js";
import { createEffect, createMemo, createSignal, For, onMount, Show, Suspense } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { AssigneeName } from "~/components/AssigneeName";
import { SlackIcon } from "~/components/icons/SlackIcon";
import { type SlackEntity, SlackEntityPicker } from "~/components/SlackEntityPicker";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger } from "~/components/ui/select";
import { Skeleton } from "~/components/ui/skeleton";
import { Textarea } from "~/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { getSeverity, getStatus } from "~/lib/incident-config";
import { getIncidentById, type IncidentEvent } from "~/lib/incidents";
import { useUpdateIncidentAssignee, useUpdateIncidentSeverity, useUpdateIncidentStatus } from "~/lib/incidents.hooks";
import { getEventConfig } from "~/lib/timeline-events";

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
	component: IncidentDetail,
});

function IncidentDetail() {
	const params = Route.useParams();
	const navigate = useNavigate();
	const getIncidentByIdFn = useServerFn(getIncidentById);
	const incidentQuery = useQuery(() => ({
		queryKey: ["incident", params().incidentId],
		queryFn: () => getIncidentByIdFn({ data: { id: params().incidentId } }),
		staleTime: Infinity,
		refetchInterval: 5_000,
	}));
	const incident = () => incidentQuery.data;

	createEffect(() => {
		if (incidentQuery.data?.error === "NOT_FOUND") {
			console.log("Would navigate to /analysis/:incidentId", params().incidentId);
			// TODO: navigate({ to: "/analysis/:incidentId", params: { incidentId: params().incidentId } });
			navigate({ to: "/" });
		}
	});

	return (
		<div class="flex-1 bg-background p-6 md:p-8">
			<div class="max-w-5xl mx-auto">
				<Link to="/" class="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-6">
					<ArrowLeft class="w-4 h-4" />
					Back to incidents
				</Link>

				<Suspense fallback={<IncidentSkeleton />}>
					<Show when={incident()?.state}>
						{(state) => (
							<div class="space-y-6">
								<IncidentHeader incident={state} />
								<Show when={incident()?.events}>{(events) => <Timeline events={events()} />}</Show>
							</div>
						)}
					</Show>
				</Suspense>
			</div>
		</div>
	);
}

function IncidentHeader(props: { incident: Accessor<IS> }) {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const incident = () => props.incident();
	const updateSeverityMutation = useUpdateIncidentSeverity(incident().id);
	const updateAssigneeMutation = useUpdateIncidentAssignee(incident().id);
	const updateStatusMutation = useUpdateIncidentStatus(incident().id, {
		onSuccess: async (status) => {
			if (status === "resolved") {
				const previousIncidents = queryClient.getQueryData<IS[]>(["incidents"]);
				if (previousIncidents) {
					const newIncidents = previousIncidents.filter((i) => i.id !== incident().id);
					queryClient.setQueryData(["incidents"], newIncidents);
				}
				await queryClient.invalidateQueries({ queryKey: ["incidents"] });
				navigate({ to: "/" });
			}
		},
	});

	const status = () => getStatus(incident().status);

	const [open, setOpen] = createSignal(false);

	const [statusDialogOpen, setStatusDialogOpen] = createSignal(false);
	const [selectedStatus, setSelectedStatus] = createSignal<"mitigating" | "resolved" | null>(null);
	const [statusMessage, setStatusMessage] = createSignal("");

	const availableTransitions = createMemo(() => {
		const current = incident().status;
		if (current === "open") return ["mitigating", "resolved"] as const;
		if (current === "mitigating") return ["resolved"] as const;
		return [] as const;
	});

	const handleStatusClick = (newStatus: "mitigating" | "resolved") => {
		setSelectedStatus(newStatus);
		setStatusMessage("");
		setStatusDialogOpen(true);
	};

	const handleStatusConfirm = async () => {
		const newStatus = selectedStatus();
		if (!newStatus || !statusMessage().trim()) return;

		await updateStatusMutation.mutateAsync({ status: newStatus, message: statusMessage() });
		setStatusDialogOpen(false);
		setSelectedStatus(null);
		setStatusMessage("");
	};

	const severityConfig = () => getSeverity(incident().severity);

	return (
		<div class="space-y-6">
			<Dialog open={statusDialogOpen()} onOpenChange={setStatusDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							Update Status to <span class="capitalize">{selectedStatus()}</span>
						</DialogTitle>
						<DialogDescription>Please provide a message explaining this status change.</DialogDescription>
					</DialogHeader>
					<div class="py-4">
						<Textarea placeholder="Describe what changed..." value={statusMessage()} onInput={(e) => setStatusMessage(e.currentTarget.value)} class="min-h-[100px]" />
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setStatusDialogOpen(false)}>
							Cancel
						</Button>
						<Button onClick={handleStatusConfirm} disabled={!statusMessage().trim() || updateStatusMutation.isPending}>
							{updateStatusMutation.isPending ? "Updating..." : "Confirm"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<div class="space-y-4">
				<div class="flex items-start justify-between gap-4">
					<h1 class="text-3xl font-bold tracking-tight">{incident().title}</h1>
					<Show
						when={availableTransitions().length > 0}
						fallback={
							<Badge round class={`${status().bg} ${status().color} border-transparent h-8 px-3 text-sm shrink-0`}>
								<span class={`w-2 h-2 rounded-full mr-2 ${status().dot}`} />
								{status().label}
							</Badge>
						}
					>
						<Popover>
							<PopoverTrigger
								as={Badge}
								round
								class={`${status().bg} ${status().color} border-transparent h-8 px-3 text-sm shrink-0 cursor-pointer hover:opacity-80 transition-opacity`}
							>
								<span class={`w-2 h-2 rounded-full mr-2 ${status().dot}`} />
								{status().label}
							</PopoverTrigger>
							<PopoverContent class="w-48 p-2">
								<div class="space-y-1">
									<p class="text-xs text-muted-foreground px-2 py-1">Change status to:</p>
									<For each={availableTransitions()}>
										{(newStatus) => {
											const config = getStatus(newStatus);
											return (
												<button
													type="button"
													class="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted transition-colors cursor-pointer text-left"
													onClick={() => handleStatusClick(newStatus)}
												>
													<span class={`w-2 h-2 rounded-full ${config.dot}`} />
													<span class="capitalize text-sm">{config.label}</span>
												</button>
											);
										}}
									</For>
								</div>
							</PopoverContent>
						</Popover>
					</Show>
				</div>
				<div class="flex flex-wrap items-center gap-3">
					<Select
						value={incident().severity}
						onChange={(val) => val && updateSeverityMutation.mutate(val)}
						options={["low", "medium", "high"]}
						itemComponent={(props) => {
							const config = getSeverity(props.item.rawValue);
							return (
								<SelectItem item={props.item}>
									<div class="flex items-center gap-2">
										<div class={`w-2 h-2 rounded-full ${config.dot}`} />
										<span class="capitalize">{props.item.rawValue}</span>
									</div>
								</SelectItem>
							);
						}}
					>
						<SelectTrigger class="w-32 h-8 gap-2 bg-muted/50 border-transparent hover:bg-muted">
							<div class={`w-2 h-2 rounded-full ${severityConfig().dot}`} />
							<span class="capitalize text-sm">{incident().severity}</span>
						</SelectTrigger>
						<SelectContent />
					</Select>

					<span class="text-muted-foreground/40">·</span>

					<Popover open={open()} onOpenChange={setOpen}>
						<PopoverTrigger as={Button} variant="ghost" size="sm" class="h-8 gap-2 bg-muted/50 hover:bg-muted font-normal">
							<User class="h-4 w-4 text-muted-foreground" />
							<span class="text-sm">
								<AssigneeName id={() => incident().assignee} />
							</span>
						</PopoverTrigger>
						<PopoverContent class="p-0 w-[280px]">
							<SlackEntityPicker
								onSelect={(entity: SlackEntity) => {
									updateAssigneeMutation.mutate(entity.data.id);
									setOpen(false);
								}}
								selectedId={incident().assignee ?? undefined}
								placeholder="Change assignee..."
								emptyMessage="No users or groups found."
							/>
						</PopoverContent>
					</Popover>
				</div>
			</div>
		</div>
	);
}

function formatTime(timestamp: string) {
	const date = new Date(timestamp);
	return date.toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function Timeline(props: { events: IncidentEvent[] }) {
	const [events, setEvents] = createStore<IncidentEvent[]>([]);

	createEffect(() => {
		setEvents(reconcile(props.events, { key: "id" }));
	});

	return (
		<Card>
			<CardHeader>
				<CardTitle class="flex items-center gap-2 text-lg">
					<Clock class="w-5 h-5 text-muted-foreground" />
					Timeline
				</CardTitle>
			</CardHeader>
			<CardContent>
				<div>
					<div class="relative">
						<div class="absolute left-4 top-0 bottom-0 w-px bg-border" />
						<div class="space-y-6">
							<For each={events}>{(event) => <TimelineRow event={event} />}</For>
						</div>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}

const ADAPTER_ICON = {
	slack: SlackIcon,
	dashboard: Monitor,
} as const satisfies Record<"slack" | "dashboard", Component>;

function TimelineRow(props: { event: IncidentEvent }) {
	const config = getEventConfig(props.event.event_type);
	const Icon = config.icon;
	const Render = config.render;
	const AdapterIcon = ADAPTER_ICON[props.event.adapter];

	const animationClasses = ["animate-in", "fade-in", "slide-in-from-top-2", "duration-300"];

	let el!: HTMLDivElement;

	onMount(() => {
		const handler = (e: AnimationEvent) => {
			if (e.target !== el) return;
			el.classList.remove(...animationClasses);
			el.removeEventListener("animationend", handler);
		};

		el.addEventListener("animationend", handler);
	});

	return (
		<div ref={el} class={`relative flex gap-4 pl-0 ${animationClasses.join(" ")}`}>
			<div class={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${config.iconBg}`}>
				<Icon class={`h-4 w-4 ${config.iconColor}`} />
			</div>
			<div class="flex-1 pt-0.5">
				<div class="flex items-center gap-2 mb-1">
					<span class="font-medium text-sm text-foreground">{config.label}</span>
					<span class="text-xs text-muted-foreground">{formatTime(props.event.created_at)}</span>
					<span class="text-muted-foreground/40">·</span>
					<Tooltip>
						<TooltipTrigger>
							<AdapterIcon class="w-3 h-3 text-muted-foreground/60" />
						</TooltipTrigger>
						<TooltipContent>
							<p class="text-[10px] capitalize">{props.event.adapter}</p>
						</TooltipContent>
					</Tooltip>
				</div>
				<Render data={props.event.event_data} />
			</div>
		</div>
	);
}
