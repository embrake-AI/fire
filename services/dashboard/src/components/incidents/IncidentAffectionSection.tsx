import type { IS } from "@fire/common";
import { Popover as PopoverPrimitive } from "@kobalte/core/popover";
import { MessageSquare, Plus, Settings2, X } from "lucide-solid";
import { createMemo, createSignal, For, Show } from "solid-js";
import { EntityPicker } from "~/components/EntityPicker";
import { UserAvatar } from "~/components/UserAvatar";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "~/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger } from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import type { AffectionImpact, AffectionStatus, IncidentAffectionData } from "~/lib/incident-affections/incident-affections";
import {
	useAddIncidentAffectionUpdate,
	useCreateIncidentAffection,
	useIncidentAffection,
	useUpdateIncidentAffectionServices,
} from "~/lib/incident-affections/incident-affections.hooks";
import type { getServices } from "~/lib/services/services";
import { useServices } from "~/lib/services/services.hooks";
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

type SelectedService = {
	id: string;
	name: string;
	imageUrl: string | null;
	impact: AffectionImpact;
};

function formatAffectionTime(value: Date) {
	return new Date(value).toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

export function IncidentAffectionSection(props: { incidentId: string; incidentStatus: IS["status"] }) {
	const affectionQuery = useIncidentAffection(() => props.incidentId);
	const servicesQuery = useServices();
	const createAffectionMutation = useCreateIncidentAffection();
	const addUpdateMutation = useAddIncidentAffectionUpdate(() => props.incidentId);
	const updateServicesMutation = useUpdateIncidentAffectionServices(() => props.incidentId);

	const [createOpen, setCreateOpen] = createSignal(false);
	const [updateOpen, setUpdateOpen] = createSignal(false);
	const [servicesOpen, setServicesOpen] = createSignal(false);

	const affection = () => affectionQuery.data ?? null;
	const isLive = () => props.incidentStatus !== "resolved" && props.incidentStatus !== "declined";

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
					<span class="text-xs text-muted-foreground">Incident is resolved or declined. Affection updates are read-only.</span>
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
