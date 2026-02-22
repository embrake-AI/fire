import type { IS } from "@fire/common";
import { Popover as PopoverPrimitive } from "@kobalte/core/popover";
import { useQuery, useQueryClient } from "@tanstack/solid-query";
import { createFileRoute, Link } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { ArrowLeft, MessageSquare, Plus, Settings2, X } from "lucide-solid";
import type { Accessor } from "solid-js";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { EntityPicker } from "~/components/EntityPicker";
import { UserDisplay } from "~/components/MaybeUser";
import { SlackMessageInput } from "~/components/SlackMessageInput";
import { Timeline } from "~/components/Timeline";
import { UserAvatar } from "~/components/UserAvatar";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "~/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger } from "~/components/ui/select";
import { Skeleton } from "~/components/ui/skeleton";
import { Tabs, TabsContent, TabsIndicator, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Textarea } from "~/components/ui/textarea";
import { requireRoutePermission } from "~/lib/auth/route-guards";
import { runDemoAware } from "~/lib/demo/runtime";
import { getIncidentByIdDemo, getIncidentsDemo } from "~/lib/demo/store";
import type { AffectionImpact, AffectionStatus, IncidentAffectionData } from "~/lib/incident-affections/incident-affections";
import {
	useAddIncidentAffectionUpdate,
	useCreateIncidentAffection,
	useIncidentAffection,
	useUpdateIncidentAffectionServices,
} from "~/lib/incident-affections/incident-affections.hooks";
import { getSeverity, getStatus } from "~/lib/incident-config";
import { getIncidentById, getIncidents } from "~/lib/incidents/incidents";
import { useUpdateIncidentAssignee, useUpdateIncidentSeverity, useUpdateIncidentStatus } from "~/lib/incidents/incidents.hooks";
import type { getServices } from "~/lib/services/services";
import { useServices } from "~/lib/services/services.hooks";
import { usePossibleSlackUsers, useUserBySlackId } from "~/lib/users/users.hooks";
import { cn } from "~/lib/utils/client";

type ServiceListItem = Awaited<ReturnType<typeof getServices>>[number];

const AFFECTION_STATUS_ORDER: AffectionStatus[] = ["investigating", "mitigating", "resolved"];

const AFFECTION_STATUS_CONFIG: Record<AffectionStatus, { label: string; bg: string; color: string; dot: string }> = {
	investigating: {
		label: "Investigating",
		bg: "bg-red-100",
		color: "text-red-600",
		dot: "bg-red-500",
	},
	mitigating: {
		label: "Mitigating",
		bg: "bg-amber-100",
		color: "text-amber-600",
		dot: "bg-amber-500",
	},
	resolved: {
		label: "Resolved",
		bg: "bg-emerald-100",
		color: "text-emerald-600",
		dot: "bg-emerald-500",
	},
};

const IMPACT_CONFIG: Record<AffectionImpact, { label: string; class: string }> = {
	partial: {
		label: "Partial",
		class: "border-amber-200 bg-amber-50 text-amber-700",
	},
	major: {
		label: "Major",
		class: "border-red-200 bg-red-50 text-red-700",
	},
};

const INLINE_POPOVER_CONTENT_CLASS =
	"z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95";

function formatAffectionTime(value: Date) {
	return new Date(value).toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

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

function IncidentHeader(props: { incident: Accessor<IS> }) {
	const queryClient = useQueryClient();
	const incident = () => props.incident();
	const updateSeverityMutation = useUpdateIncidentSeverity(() => incident().id);
	const updateAssigneeMutation = useUpdateIncidentAssignee(() => incident().id);
	const updateStatusMutation = useUpdateIncidentStatus(() => incident().id, {
		onSuccess: async (status) => {
			if (status === "resolved") {
				const previousIncidents = queryClient.getQueryData<IS[]>(["incidents"]);
				if (previousIncidents) {
					const newIncidents = previousIncidents.filter((i) => i.id !== incident().id);
					queryClient.setQueryData(["incidents"], newIncidents);
				}
				await queryClient.invalidateQueries({ queryKey: ["incidents"] });
			}
		},
	});

	const user = useUserBySlackId(() => incident().assignee.slackId);

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

	const possibleSlackUsers = usePossibleSlackUsers();

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
						<Textarea placeholder="Describe what changed..." value={statusMessage()} onInput={(e) => setStatusMessage(e.currentTarget.value)} class="min-h-25" />
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
							<UserDisplay user={user} withName />
						</PopoverTrigger>
						<PopoverContent class="p-0 w-70">
							<EntityPicker
								entities={possibleSlackUsers}
								onSelect={(entity) => {
									updateAssigneeMutation.mutate(entity.type === "user" ? entity.slackId : entity.id);
									setOpen(false);
								}}
								selectedId={incident().assignee.slackId}
								placeholder="Change assignee..."
								emptyMessage="No users found."
							/>
						</PopoverContent>
					</Popover>
				</div>
			</div>
		</div>
	);
}

function IncidentAffectionSection(props: { incidentId: string; incidentStatus: IS["status"] }) {
	const affectionQuery = useIncidentAffection(() => props.incidentId);
	const servicesQuery = useServices();
	const createAffectionMutation = useCreateIncidentAffection();
	const addUpdateMutation = useAddIncidentAffectionUpdate(() => props.incidentId);
	const updateServicesMutation = useUpdateIncidentAffectionServices(() => props.incidentId);

	const [createOpen, setCreateOpen] = createSignal(false);
	const [updateOpen, setUpdateOpen] = createSignal(false);
	const [servicesOpen, setServicesOpen] = createSignal(false);

	const affection = () => affectionQuery.data ?? null;
	const isLive = () => props.incidentStatus !== "resolved";

	const services = () => servicesQuery.data ?? [];

	const handleCreateAffection = async (data: { title: string; initialMessage: string; services: SelectedService[] }) => {
		await createAffectionMutation.mutateAsync({
			incidentId: props.incidentId,
			title: data.title,
			initialMessage: data.initialMessage,
			services: data.services.map((s) => ({ id: s.id, impact: s.impact })),
			_optimistic: {
				services: data.services,
			},
		});
		setCreateOpen(false);
	};

	const handleAddUpdate = async (data: { message: string; status?: AffectionStatus }) => {
		await addUpdateMutation.mutateAsync({
			incidentId: props.incidentId,
			message: data.message,
			status: data.status,
		});
		setUpdateOpen(false);
	};

	const handleUpdateServices = async (updatedServices: { id: string; impact: AffectionImpact }[]) => {
		const currentAffection = affection();
		if (!currentAffection) return;
		await updateServicesMutation.mutateAsync({
			affectionId: currentAffection.id,
			services: updatedServices,
		});
		setServicesOpen(false);
	};

	return (
		<Card>
			<CardHeader class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<CardTitle class="flex items-center gap-2 text-lg">
						<MessageSquare class="w-5 h-5 text-muted-foreground" />
						Status Page Impact
					</CardTitle>
					<CardDescription>Manage the update shown on your status page for this incident.</CardDescription>
				</div>
				<Show when={affection()}>{(data) => <AffectionStatusBadge status={data().currentStatus} />}</Show>
			</CardHeader>
			<CardContent>
				<Show
					when={affection()}
					fallback={
						<div class="rounded-md border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
							No status page impact has been created for this incident yet.
						</div>
					}
				>
					{(data) => <AffectionDetails affection={data()} />}
				</Show>
			</CardContent>
			<CardFooter class="flex flex-wrap items-center justify-between gap-3">
				<Show
					when={affection()}
					fallback={
						<Button size="sm" onClick={() => setCreateOpen(true)} disabled={!isLive() || createAffectionMutation.isPending}>
							<Plus class="w-4 h-4" />
							Create affection
						</Button>
					}
				>
					<div class="flex items-center gap-2">
						<Button size="sm" variant="outline" onClick={() => setServicesOpen(true)} disabled={!isLive() || updateServicesMutation.isPending}>
							<Settings2 class="w-4 h-4" />
							Edit services
						</Button>
						<Button size="sm" onClick={() => setUpdateOpen(true)} disabled={!isLive() || addUpdateMutation.isPending}>
							<MessageSquare class="w-4 h-4" />
							Post update
						</Button>
					</div>
				</Show>
				<Show when={!isLive()}>
					<span class="text-xs text-muted-foreground">Incident is resolved. Affection updates are read-only.</span>
				</Show>
			</CardFooter>

			<Dialog open={createOpen()} onOpenChange={setCreateOpen}>
				<Show when={createOpen()}>
					<CreateAffectionDialogContent
						services={services()}
						isSubmitting={createAffectionMutation.isPending}
						onSubmit={handleCreateAffection}
						onClose={() => setCreateOpen(false)}
					/>
				</Show>
			</Dialog>

			<Dialog open={updateOpen()} onOpenChange={setUpdateOpen}>
				<Show when={updateOpen() && affection()}>
					{(data) => (
						<AddAffectionUpdateDialogContent affection={data()} isSubmitting={addUpdateMutation.isPending} onSubmit={handleAddUpdate} onClose={() => setUpdateOpen(false)} />
					)}
				</Show>
			</Dialog>

			<Dialog open={servicesOpen()} onOpenChange={setServicesOpen}>
				<Show when={servicesOpen() && affection()}>
					{(data) => (
						<EditAffectionServicesDialogContent
							affection={data()}
							services={services()}
							isSubmitting={updateServicesMutation.isPending}
							onSubmit={handleUpdateServices}
							onClose={() => setServicesOpen(false)}
						/>
					)}
				</Show>
			</Dialog>
		</Card>
	);
}

type SelectedService = {
	id: string;
	name: string;
	imageUrl: string | null;
	impact: AffectionImpact;
};

function AffectionDetails(props: { affection: IncidentAffectionData }) {
	const lastUpdate = () => props.affection.lastUpdate;
	const lastUpdateLabel = () => (lastUpdate()?.status ? AFFECTION_STATUS_CONFIG[lastUpdate()!.status!].label : "Update");

	return (
		<div class="space-y-4">
			<div>
				<p class="text-sm font-medium text-foreground">Title</p>
				<p class="text-sm text-muted-foreground">{props.affection.title}</p>
			</div>

			<div>
				<p class="text-sm font-medium text-foreground">Affected services</p>
				<div class="flex flex-wrap gap-2 mt-2">
					<For each={props.affection.services}>
						{(service) => (
							<div class="flex items-center gap-2 rounded-full border border-border bg-muted/30 px-2.5 py-1 text-xs">
								<span class="font-medium text-foreground truncate">{service.name}</span>
								<ImpactBadge impact={service.impact} />
							</div>
						)}
					</For>
				</div>
			</div>

			<div>
				<p class="text-sm font-medium text-foreground">Last update</p>
				<div class="mt-2 rounded-md border border-border bg-muted/30 p-4 space-y-2">
					<div class="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
						<span>{lastUpdate() ? formatAffectionTime(lastUpdate()!.createdAt) : "No updates yet"}</span>
						<Badge variant="outline" class="text-xs">
							{lastUpdateLabel()}
						</Badge>
					</div>
					<p class="text-sm text-foreground">{lastUpdate()?.message ?? "No updates have been posted yet."}</p>
				</div>
			</div>
		</div>
	);
}

function AffectionStatusBadge(props: { status: AffectionStatus }) {
	const config = () => AFFECTION_STATUS_CONFIG[props.status];
	return (
		<Badge round class={`${config().bg} ${config().color} border-transparent h-8 px-3 text-sm shrink-0`}>
			<span class={`w-2 h-2 rounded-full mr-2 ${config().dot}`} />
			{config().label}
		</Badge>
	);
}

function ImpactBadge(props: { impact: AffectionImpact }) {
	const config = () => IMPACT_CONFIG[props.impact];
	return (
		<Badge variant="outline" class={`text-[11px] font-medium ${config().class}`}>
			{config().label}
		</Badge>
	);
}

function CreateAffectionDialogContent(props: {
	services: ServiceListItem[];
	isSubmitting: boolean;
	onSubmit: (data: { title: string; initialMessage: string; services: SelectedService[] }) => void;
	onClose: () => void;
}) {
	const [title, setTitle] = createSignal("");
	const [message, setMessage] = createSignal("");
	const [selectedServices, setSelectedServices] = createSignal<SelectedService[]>([]);

	const availableServices = createMemo(() => props.services.filter((service) => !selectedServices().some((selected) => selected.id === service.id)));
	const availableEntities = createMemo(() =>
		availableServices().map((service) => ({
			id: service.id,
			name: service.name?.trim() || "Untitled service",
			avatar: service.imageUrl,
		})),
	);

	const handleAddService = (service: { id: string }) => {
		const match = props.services.find((item) => item.id === service.id);
		if (!match) return;
		setSelectedServices((items) => [
			...items,
			{
				id: match.id,
				name: match.name?.trim() || "Untitled service",
				imageUrl: match.imageUrl ?? null,
				impact: "partial",
			},
		]);
	};

	const handleImpactChange = (serviceId: string, impact: AffectionImpact) => {
		setSelectedServices((items) => items.map((service) => (service.id === serviceId ? { ...service, impact } : service)));
	};

	const handleRemoveService = (serviceId: string) => {
		setSelectedServices((items) => items.filter((service) => service.id !== serviceId));
	};

	const canSubmit = () => title().trim() && message().trim() && selectedServices().length > 0;

	const handleSubmit = () => {
		if (!canSubmit()) return;
		props.onSubmit({
			title: title().trim(),
			initialMessage: message().trim(),
			services: selectedServices(),
		});
	};

	return (
		<DialogContent>
			<DialogHeader>
				<DialogTitle>Create status page impact</DialogTitle>
				<DialogDescription>Start tracking affected services and post an initial update.</DialogDescription>
			</DialogHeader>
			<div class="space-y-4 py-4">
				<div class="space-y-2">
					<label class="text-sm font-medium text-foreground" for="affection-title">
						Title
					</label>
					<Input id="affection-title" placeholder="Public incident title" value={title()} onInput={(e) => setTitle(e.currentTarget.value)} />
				</div>

				<div class="space-y-2">
					<label class="text-sm font-medium text-foreground" for="affection-services">
						Affected services
					</label>
					<div class="flex items-center justify-between gap-2">
						<PopoverPrimitive>
							<PopoverPrimitive.Trigger as={Button} size="sm" variant="outline" disabled={availableEntities().length === 0 || props.isSubmitting}>
								<Plus class="w-4 h-4" />
								Add service
							</PopoverPrimitive.Trigger>
							<PopoverPrimitive.Content class={cn(INLINE_POPOVER_CONTENT_CLASS, "p-0")} style={{ width: "240px" }}>
								<EntityPicker onSelect={handleAddService} entities={availableEntities} placeholder="Select a service" emptyMessage="No services to add." />
							</PopoverPrimitive.Content>
						</PopoverPrimitive>
						<span class="text-xs text-muted-foreground">{selectedServices().length} selected</span>
					</div>
					<Show when={selectedServices().length > 0} fallback={<p class="text-xs text-muted-foreground">Select at least one service to continue.</p>}>
						<div class="space-y-2" id="affection-services">
							<For each={selectedServices()}>
								{(service) => (
									<div class="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
										<div class="flex items-center gap-2 min-w-0">
											<UserAvatar name={() => service.name} avatar={() => service.imageUrl} sizeClass="w-7 h-7" />
											<span class="text-sm font-medium text-foreground truncate">{service.name}</span>
										</div>
										<div class="flex items-center gap-2">
											<ImpactSelect value={service.impact} onChange={(impact) => handleImpactChange(service.id, impact)} />
											<Button variant="ghost" size="icon" type="button" onClick={() => handleRemoveService(service.id)}>
												<X class="w-4 h-4" />
											</Button>
										</div>
									</div>
								)}
							</For>
						</div>
					</Show>
				</div>

				<div class="space-y-2">
					<label class="text-sm font-medium text-foreground" for="affection-message">
						Initial update
					</label>
					<Textarea
						id="affection-message"
						placeholder="Describe the impact and what you're investigating..."
						value={message()}
						onInput={(e) => setMessage(e.currentTarget.value)}
						class="min-h-24"
					/>
				</div>
			</div>
			<DialogFooter>
				<Button variant="outline" onClick={props.onClose}>
					Cancel
				</Button>
				<Button onClick={handleSubmit} disabled={!canSubmit() || props.isSubmitting}>
					{props.isSubmitting ? "Creating..." : "Create affection"}
				</Button>
			</DialogFooter>
		</DialogContent>
	);
}

function AddAffectionUpdateDialogContent(props: {
	affection: IncidentAffectionData;
	isSubmitting: boolean;
	onSubmit: (data: { message: string; status?: AffectionStatus }) => void;
	onClose: () => void;
}) {
	const [message, setMessage] = createSignal("");
	const [status, setStatus] = createSignal<"none" | AffectionStatus>("none");

	const availableStatuses = createMemo(() => {
		const currentIndex = AFFECTION_STATUS_ORDER.indexOf(props.affection.currentStatus);
		return AFFECTION_STATUS_ORDER.slice(Math.max(0, currentIndex + 1));
	});

	const statusOptions = createMemo(() => ["none", ...availableStatuses()]);

	const statusLabel = (value: "none" | AffectionStatus) => {
		if (value === "none") return "No status change";
		return AFFECTION_STATUS_CONFIG[value].label;
	};

	const canSubmit = () => message().trim().length > 0;

	const handleSubmit = () => {
		if (!canSubmit()) return;
		const nextStatus = status();
		props.onSubmit({
			message: message().trim(),
			status: nextStatus === "none" ? undefined : nextStatus,
		});
	};

	return (
		<DialogContent>
			<DialogHeader>
				<DialogTitle>Post an update</DialogTitle>
				<DialogDescription>Share the latest information for your status page.</DialogDescription>
			</DialogHeader>
			<div class="space-y-4 py-4">
				<Show when={availableStatuses().length > 0}>
					<div class="space-y-2">
						<label class="text-sm font-medium text-foreground" for="affection-status">
							Status (optional)
						</label>
						<Select
							value={status()}
							onChange={(val) => setStatus((val as "none" | AffectionStatus) ?? "none")}
							options={statusOptions()}
							itemComponent={(itemProps) => <SelectItem item={itemProps.item}>{statusLabel(itemProps.item.rawValue as "none" | AffectionStatus)}</SelectItem>}
						>
							<SelectTrigger id="affection-status" class="h-9">
								<span class="text-sm">{statusLabel(status())}</span>
							</SelectTrigger>
							<SelectContent />
						</Select>
					</div>
				</Show>

				<div class="space-y-2">
					<label class="text-sm font-medium text-foreground" for="affection-update-message">
						Update message
					</label>
					<Textarea id="affection-update-message" placeholder="Share the latest update..." value={message()} onInput={(e) => setMessage(e.currentTarget.value)} class="min-h-24" />
				</div>
			</div>
			<DialogFooter>
				<Button variant="outline" onClick={props.onClose}>
					Cancel
				</Button>
				<Button onClick={handleSubmit} disabled={!canSubmit() || props.isSubmitting}>
					{props.isSubmitting ? "Posting..." : "Post update"}
				</Button>
			</DialogFooter>
		</DialogContent>
	);
}

function EditAffectionServicesDialogContent(props: {
	affection: IncidentAffectionData;
	services: ServiceListItem[];
	isSubmitting: boolean;
	onSubmit: (services: { id: string; impact: AffectionImpact }[]) => void;
	onClose: () => void;
}) {
	const [selectedServices, setSelectedServices] = createSignal<SelectedService[]>(
		props.affection.services.map((service) => ({
			id: service.id,
			name: service.name,
			imageUrl: service.imageUrl ?? null,
			impact: service.impact,
		})),
	);

	const availableServices = createMemo(() => props.services.filter((service) => !selectedServices().some((selected) => selected.id === service.id)));
	const availableEntities = createMemo(() =>
		availableServices().map((service) => ({
			id: service.id,
			name: service.name?.trim() || "Untitled service",
			avatar: service.imageUrl,
		})),
	);

	const handleAddService = (service: { id: string }) => {
		const match = props.services.find((item) => item.id === service.id);
		if (!match) return;
		setSelectedServices((items) => [
			...items,
			{
				id: match.id,
				name: match.name?.trim() || "Untitled service",
				imageUrl: match.imageUrl ?? null,
				impact: "partial",
			},
		]);
	};

	const handleImpactChange = (serviceId: string, impact: AffectionImpact) => {
		setSelectedServices((items) => items.map((service) => (service.id === serviceId ? { ...service, impact } : service)));
	};

	const handleRemoveService = (serviceId: string) => {
		setSelectedServices((items) => items.filter((service) => service.id !== serviceId));
	};

	const canSubmit = () => selectedServices().length > 0;

	const handleSubmit = () => {
		if (!canSubmit()) return;
		props.onSubmit(selectedServices().map((service) => ({ id: service.id, impact: service.impact })));
	};

	return (
		<DialogContent>
			<DialogHeader>
				<DialogTitle>Edit affected services</DialogTitle>
				<DialogDescription>Adjust the services and impact level for this incident.</DialogDescription>
			</DialogHeader>
			<div class="space-y-4 py-4">
				<div class="flex items-center justify-between gap-2">
					<PopoverPrimitive>
						<PopoverPrimitive.Trigger as={Button} size="sm" variant="outline" disabled={availableEntities().length === 0 || props.isSubmitting}>
							<Plus class="w-4 h-4" />
							Add service
						</PopoverPrimitive.Trigger>
						<PopoverPrimitive.Content class={cn(INLINE_POPOVER_CONTENT_CLASS, "p-0")} style={{ width: "240px" }}>
							<EntityPicker onSelect={handleAddService} entities={availableEntities} placeholder="Select a service" emptyMessage="No services to add." />
						</PopoverPrimitive.Content>
					</PopoverPrimitive>
					<span class="text-xs text-muted-foreground">{selectedServices().length} selected</span>
				</div>
				<Show when={selectedServices().length > 0} fallback={<p class="text-xs text-muted-foreground">Select at least one service to continue.</p>}>
					<div class="space-y-2">
						<For each={selectedServices()}>
							{(service) => (
								<div class="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
									<div class="flex items-center gap-2 min-w-0">
										<UserAvatar name={() => service.name} avatar={() => service.imageUrl} sizeClass="w-7 h-7" />
										<span class="text-sm font-medium text-foreground truncate">{service.name}</span>
									</div>
									<div class="flex items-center gap-2">
										<ImpactSelect value={service.impact} onChange={(impact) => handleImpactChange(service.id, impact)} />
										<Button variant="ghost" size="icon" type="button" onClick={() => handleRemoveService(service.id)}>
											<X class="w-4 h-4" />
										</Button>
									</div>
								</div>
							)}
						</For>
					</div>
				</Show>
			</div>
			<DialogFooter>
				<Button variant="outline" onClick={props.onClose}>
					Cancel
				</Button>
				<Button onClick={handleSubmit} disabled={!canSubmit() || props.isSubmitting}>
					{props.isSubmitting ? "Saving..." : "Save changes"}
				</Button>
			</DialogFooter>
		</DialogContent>
	);
}

function ImpactSelect(props: { value: AffectionImpact; onChange: (impact: AffectionImpact) => void }) {
	const options: AffectionImpact[] = ["partial", "major"];
	return (
		<Select
			value={props.value}
			onChange={(val) => val && props.onChange(val as AffectionImpact)}
			options={options}
			itemComponent={(itemProps) => <SelectItem item={itemProps.item}>{IMPACT_CONFIG[itemProps.item.rawValue as AffectionImpact].label}</SelectItem>}
		>
			<SelectTrigger class="h-8 w-28 text-xs">
				<span class="text-xs">{IMPACT_CONFIG[props.value].label}</span>
			</SelectTrigger>
			<SelectContent />
		</Select>
	);
}
