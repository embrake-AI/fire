import { SHIFT_LENGTH_OPTIONS, type ShiftLength } from "@fire/common";
import { useQuery } from "@tanstack/solid-query";
import { createFileRoute, Link } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { ChevronDown, ChevronUp, Clock, GripVertical, Link2, LoaderCircle, Plus, RefreshCw, Users, X } from "lucide-solid";
import { type Accessor, createEffect, createSignal, For, Index, Show, Suspense } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { type SlackEntity, SlackEntityPicker, UserAvatar } from "~/components/SlackEntityPicker";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import {
	ConfigCard,
	ConfigCardActions,
	ConfigCardContent,
	ConfigCardDeleteButton,
	ConfigCardExpandedContent,
	ConfigCardIcon,
	ConfigCardRow,
	ConfigCardTitle,
} from "~/components/ui/config-card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Skeleton } from "~/components/ui/skeleton";
import { getIntegrations } from "~/lib/integrations";
import { getRotations } from "~/lib/rotation";
import {
	toAddAssigneeInput,
	useAddRotationAssignee,
	useClearRotationOverride,
	useCreateRotation,
	useDeleteRotation,
	useRemoveRotationAssignee,
	useReorderRotationAssignee,
	useSetRotationOverride,
} from "~/lib/rotation.hooks";
import { useSlackUser } from "~/lib/useSlackUser";

export const Route = createFileRoute("/_authed/config/rotation")({
	component: RotationConfig,
});

function RotationConfig() {
	return (
		<Card class="p-6">
			<Suspense fallback={<RotationContentSkeleton />}>
				<RotationContent />
			</Suspense>
		</Card>
	);
}

// --- Main Content ---

function RotationContent() {
	const getRotationsFn = useServerFn(getRotations);
	const rotationsQuery = useQuery(() => ({
		queryKey: ["rotations"],
		queryFn: getRotationsFn,
		staleTime: 60_000,
	}));
	const rotations = () => rotationsQuery.data ?? [];

	const [isCreating, setIsCreating] = createSignal(false);
	const [expandedId, setExpandedId] = createSignal<string | null>(null);

	const createMutation = useCreateRotation({
		onMutate: (tempId) => {
			setIsCreating(false);
			setExpandedId(tempId);
		},
		onSuccess: (realId) => {
			setExpandedId(realId);
		},
	});

	const deleteMutation = useDeleteRotation();

	const handleCreate = (name: string, shiftLength: ShiftLength) => {
		createMutation.mutate({ name, shiftLength });
	};

	const handleDelete = (id: string) => {
		if (expandedId() === id) {
			setExpandedId(null);
		}
		deleteMutation.mutate(id);
	};

	const toggleExpanded = (id: string) => {
		setExpandedId((current) => (current === id ? null : id));
	};

	return (
		<div class="space-y-6">
			<Show when={!isCreating()} fallback={<CreateRotationForm onSubmit={handleCreate} onCancel={() => setIsCreating(false)} isSubmitting={() => createMutation.isPending} />}>
				<Button onClick={() => setIsCreating(true)} disabled={createMutation.isPending}>
					<Plus class="w-4 h-4" />
					Create Rotation
				</Button>
			</Show>

			<Show
				when={rotations().length > 0}
				fallback={
					<Show when={!isCreating()}>
						<RotationEmptyState />
					</Show>
				}
			>
				<div class="space-y-3">
					<Index each={rotations()}>
						{(rotation) => (
							<RotationCard
								rotation={rotation()}
								isExpanded={expandedId() === rotation().id}
								onToggle={() => toggleExpanded(rotation().id)}
								onDelete={() => handleDelete(rotation().id)}
								isDeleting={deleteMutation.isPending && deleteMutation.variables === rotation().id}
							/>
						)}
					</Index>
				</div>
			</Show>

			<RotationFooter count={rotations().filter((r) => r.assignees.length > 0).length} />
		</div>
	);
}

// --- Footer ---

interface RotationFooterProps {
	count: number;
}

function RotationFooter(props: RotationFooterProps) {
	return (
		<Show when={props.count > 0}>
			<div class="pt-4 border-t border-border">
				<p class="text-sm text-muted-foreground">
					<span class="font-medium text-foreground">{props.count}</span> rotation
					{props.count !== 1 && "s"} configured
				</p>
			</div>
		</Show>
	);
}

// --- Create Rotation Form ---

interface CreateRotationFormProps {
	onSubmit: (name: string, shiftLength: ShiftLength) => void;
	onCancel: () => void;
	isSubmitting: Accessor<boolean>;
}

function CreateRotationForm(props: CreateRotationFormProps) {
	const [name, setName] = createSignal("");
	const [shiftLength, setShiftLength] = createSignal<ShiftLength>("1 week");

	const handleSubmit = (e: Event) => {
		e.preventDefault();
		if (name().trim()) {
			props.onSubmit(name().trim(), shiftLength());
		}
	};

	return (
		<div class="border border-border rounded-lg bg-muted/20 overflow-hidden">
			<div class="flex items-center justify-between px-4 py-3 border-b border-border">
				<h4 class="text-sm font-medium text-foreground">Create new rotation</h4>
				<Button variant="ghost" size="icon" class="h-8 w-8 cursor-pointer" onClick={props.onCancel}>
					<X class="w-4 h-4" />
				</Button>
			</div>
			<form onSubmit={handleSubmit} class="p-4 space-y-4">
				<div class="space-y-2">
					<Label for="rotation-name">Name</Label>
					<Input id="rotation-name" placeholder="e.g., Primary On-Call" value={name()} onInput={(e) => setName(e.currentTarget.value)} autofocus />
				</div>
				<div class="space-y-2">
					<Label for="shift-length">Shift Length</Label>
					<Select
						value={shiftLength()}
						onChange={(value) => value && setShiftLength(value)}
						options={SHIFT_LENGTH_OPTIONS.map((o) => o.value)}
						itemComponent={(props) => <SelectItem item={props.item}>{SHIFT_LENGTH_OPTIONS.find((o) => o.value === props.item.rawValue)?.label}</SelectItem>}
					>
						<SelectTrigger id="shift-length" class="w-full">
							<SelectValue<string>>{(state) => SHIFT_LENGTH_OPTIONS.find((o) => o.value === state.selectedOption())?.label}</SelectValue>
						</SelectTrigger>
						<SelectContent />
					</Select>
				</div>
				<div class="flex justify-end gap-2">
					<Button type="button" variant="ghost" onClick={props.onCancel}>
						Cancel
					</Button>
					<Button type="submit" disabled={!name().trim() || props.isSubmitting()}>
						<Show when={props.isSubmitting()} fallback={<Plus class="w-4 h-4" />}>
							<LoaderCircle class="w-4 h-4 animate-spin" />
						</Show>
						Create
					</Button>
				</div>
			</form>
		</div>
	);
}

// --- Helpers ---

function formatShiftLength(interval: string) {
	const match = interval.match(/(\d+) (days|weeks|months)/);
	if (match) {
		const days = Number.parseInt(match[1], 10);
		if (days === 7) return "weekly";
		if (days === 14) return "biweekly";
		return `${days} days`;
	}
	return interval;
}

// --- Rotation Card ---

type Rotation = Awaited<ReturnType<typeof getRotations>>[number];

interface RotationCardProps {
	rotation: Rotation;
	isExpanded: boolean;
	onToggle: () => void;
	onDelete: () => void;
	isDeleting: boolean;
}

function RotationCard(props: RotationCardProps) {
	const addAssigneeMutation = useAddRotationAssignee();
	const removeAssigneeMutation = useRemoveRotationAssignee();
	const reorderMutation = useReorderRotationAssignee();
	const overrideMutation = useSetRotationOverride();
	const clearOverrideMutation = useClearRotationOverride();

	const [isAddingAssignee, setIsAddingAssignee] = createSignal(false);

	const currentAssignee = () => props.rotation.assignees.find((a) => a.isOverride) ?? props.rotation.assignees.find((a) => a.isBaseAssignee);

	const handleSelectAssignee = (entity: SlackEntity) => {
		if (entity.type === "user") {
			addAssigneeMutation.mutate(toAddAssigneeInput(props.rotation.id, entity));
		}
		setIsAddingAssignee(false);
	};

	const handleRemoveAssignee = (assigneeId: string) => {
		removeAssigneeMutation.mutate({ rotationId: props.rotation.id, assigneeId });
	};

	const handleOverrideAssignee = (assigneeId: string) => {
		overrideMutation.mutate({ rotationId: props.rotation.id, assigneeId });
	};

	const handleClearOverride = () => {
		clearOverrideMutation.mutate({ rotationId: props.rotation.id });
	};

	const handleReorderAssignee = (assigneeId: string, newPosition: number) => {
		reorderMutation.mutate({ rotationId: props.rotation.id, assigneeId, newPosition });
	};

	return (
		<ConfigCard isActive={props.isExpanded}>
			<ConfigCardRow onClick={props.onToggle}>
				<Show
					when={currentAssignee()}
					fallback={
						<ConfigCardIcon variant="violet" size="sm">
							<RefreshCw class="w-4 h-4" />
						</ConfigCardIcon>
					}
				>
					{(assignee) => <UserAvatar id={assignee().id} />}
				</Show>

				<span class="flex items-center gap-2">
					<ConfigCardTitle class="shrink-0">{props.rotation.name}</ConfigCardTitle>
					<Badge variant="outline" class="font-normal text-xs shrink-0">
						<Clock class="w-3 h-3 mr-1" />
						{formatShiftLength(props.rotation.shiftLength)}
					</Badge>
				</span>

				<span class="flex-1" />

				<span class="flex items-center gap-3 shrink-0">
					<Show when={props.rotation.assignees.length > 0} fallback={<span class="text-sm text-amber-600">No assignees configured</span>}>
						<span class="text-sm text-muted-foreground">
							{props.rotation.assignees.length} assignee{props.rotation.assignees.length !== 1 && "s"} in rotation
						</span>
					</Show>
					<ConfigCardActions animated alwaysVisible={props.isExpanded}>
						<ConfigCardDeleteButton
							onDelete={props.onDelete}
							isDeleting={props.isDeleting}
							alwaysVisible
							disabledReason={props.rotation.isInUse ? "Used in an entry point" : undefined}
						/>
					</ConfigCardActions>
					<Show when={props.isExpanded} fallback={<ChevronDown class="w-4 h-4 text-muted-foreground" />}>
						<ChevronUp class="w-4 h-4 text-muted-foreground" />
					</Show>
				</span>
			</ConfigCardRow>

			<Show when={props.isExpanded}>
				<ConfigCardExpandedContent>
					<RotationAssigneesSection
						assignees={props.rotation.assignees}
						isAddingAssignee={isAddingAssignee()}
						onStartAdding={() => setIsAddingAssignee(true)}
						onCancelAdding={() => setIsAddingAssignee(false)}
						onSelectAssignee={handleSelectAssignee}
						onRemoveAssignee={handleRemoveAssignee}
						onReorderAssignee={handleReorderAssignee}
						onOverrideAssignee={handleOverrideAssignee}
						onClearOverride={handleClearOverride}
						isAdding={addAssigneeMutation.isPending}
						isRemoving={removeAssigneeMutation.isPending}
						removingId={removeAssigneeMutation.variables?.assigneeId}
						isReordering={reorderMutation.isPending}
						isOverriding={overrideMutation.isPending}
						overridingId={overrideMutation.variables?.assigneeId ?? undefined}
						isClearingOverride={clearOverrideMutation.isPending}
					/>
				</ConfigCardExpandedContent>
			</Show>
		</ConfigCard>
	);
}

function RotationAssigneesSection(props: {
	assignees: Rotation["assignees"];
	isAddingAssignee: boolean;
	onStartAdding: () => void;
	onCancelAdding: () => void;
	onSelectAssignee: (entity: SlackEntity) => void;
	onRemoveAssignee: (id: string) => void;
	onReorderAssignee: (id: string, newPosition: number) => void;
	onOverrideAssignee: (id: string) => void;
	onClearOverride: () => void;
	isAdding: boolean;
	isRemoving: boolean;
	removingId?: string;
	isReordering: boolean;
	isOverriding: boolean;
	overridingId?: string;
	isClearingOverride: boolean;
}) {
	const [assignees, setAssignees] = createStore<Rotation["assignees"]>([]);
	const [draggedId, setDraggedId] = createSignal<string | null>(null);
	const [dropTargetIndex, setDropTargetIndex] = createSignal<number | null>(null);

	createEffect(() => {
		setAssignees(reconcile(props.assignees, { key: "id" }));
	});

	const handleDragStart = (assigneeId: string) => {
		setDraggedId(assigneeId);
	};

	const handleDragEnd = () => {
		const draggedAssigneeId = draggedId();
		const targetIndex = dropTargetIndex();

		if (draggedAssigneeId && targetIndex !== null) {
			const currentIndex = assignees.findIndex((a) => a.id === draggedAssigneeId);
			if (currentIndex !== -1 && currentIndex !== targetIndex) {
				props.onReorderAssignee(draggedAssigneeId, targetIndex);
			}
		}

		setDraggedId(null);
		setDropTargetIndex(null);
	};

	const handleDragOver = (index: number) => {
		if (draggedId()) {
			setDropTargetIndex(index);
		}
	};

	return (
		<section class="space-y-3">
			<header class="flex items-center justify-between">
				<h5 class="text-sm font-medium text-foreground">Rotation Order</h5>
				<Show when={!props.isAddingAssignee}>
					<Button variant="ghost" size="sm" class="h-7 text-xs" onClick={props.onStartAdding}>
						<Plus class="w-3 h-3" />
						Add Assignee
					</Button>
				</Show>
			</header>

			<Show when={props.isAddingAssignee}>
				<Card class="overflow-hidden">
					<header class="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
						<span class="text-xs font-medium text-muted-foreground">Select user to add</span>
						<Button variant="ghost" size="icon" class="h-6 w-6 cursor-pointer" onClick={props.onCancelAdding}>
							<X class="w-3 h-3" />
						</Button>
					</header>
					<Suspense
						fallback={
							<span class="flex items-center justify-center py-6">
								<LoaderCircle class="w-4 h-4 animate-spin" />
							</span>
						}
					>
						<AddAssigneePickerContent onSelect={props.onSelectAssignee} isAdding={() => props.isAdding} existingAssigneeIds={props.assignees.map((a) => a.id)} />
					</Suspense>
				</Card>
			</Show>

			<Show when={assignees.length > 0} fallback={<AssigneesEmptyState />}>
				<div class="space-y-2">
					<For each={assignees}>
						{(assignee, index) => (
							<AssigneeCard
								assignee={assignee}
								index={index()}
								onRemove={() => props.onRemoveAssignee(assignee.id)}
								isRemoving={props.isRemoving && props.removingId === assignee.id}
								onOverride={() => props.onOverrideAssignee(assignee.id)}
								isOverriding={props.isOverriding && props.overridingId === assignee.id}
								onClearOverride={props.onClearOverride}
								isClearingOverride={props.isClearingOverride && assignee.isOverride}
								isDragging={draggedId() === assignee.id}
								isDropTarget={dropTargetIndex() === index() && draggedId() !== assignee.id}
								onDragStart={() => handleDragStart(assignee.id)}
								onDragEnd={handleDragEnd}
								onDragOver={() => handleDragOver(index())}
							/>
						)}
					</For>
				</div>
			</Show>
		</section>
	);
}

function AssigneeCard(props: {
	assignee: Rotation["assignees"][number];
	index: number;
	onRemove: () => void;
	isRemoving: boolean;
	onOverride: () => void;
	isOverriding: boolean;
	onClearOverride: () => void;
	isClearingOverride: boolean;
	isDragging: boolean;
	isDropTarget: boolean;
	onDragStart: () => void;
	onDragEnd: () => void;
	onDragOver: () => void;
}) {
	const user = useSlackUser(() => props.assignee.id);
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop container needs these handlers
		<div
			draggable={true}
			onDragStart={(e) => {
				e.dataTransfer?.setData("text/plain", props.assignee.id);
				props.onDragStart();
			}}
			onDragEnd={props.onDragEnd}
			onDragOver={(e) => {
				e.preventDefault();
				props.onDragOver();
			}}
			onDrop={(e) => {
				e.preventDefault();
			}}
			class="transition-all duration-150"
			classList={{
				"opacity-50 scale-95": props.isDragging,
				"ring-2 ring-violet-400 ring-offset-1": props.isDropTarget,
			}}
		>
			<ConfigCard class="bg-white hover:bg-gray-50" groupName="assignee">
				<ConfigCardRow class="py-2.5">
					<span class="cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-muted-foreground transition-colors">
						<GripVertical class="w-4 h-4" />
					</span>

					<UserAvatar id={props.assignee.id} />
					<Show when={user()}>
						<ConfigCardContent>
							<ConfigCardTitle>{user()?.name}</ConfigCardTitle>
						</ConfigCardContent>
					</Show>

					<Show when={props.assignee.isBaseAssignee}>
						<Badge variant="secondary" class="text-xs font-normal text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400">
							On call
						</Badge>
					</Show>

					<Show when={props.assignee.isOverride}>
						<Badge variant="secondary" class="text-xs font-normal text-amber-600 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400">
							Override
						</Badge>
					</Show>

					<ConfigCardActions animated groupName="assignee">
						<Show when={!props.assignee.isBaseAssignee && !props.assignee.isOverride}>
							<Button
								variant="ghost"
								size="sm"
								class="h-7 text-xs text-muted-foreground hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/50"
								onClick={(e) => {
									e.stopPropagation();
									props.onOverride();
								}}
								disabled={props.isOverriding}
							>
								<Show when={props.isOverriding} fallback="Set override">
									<LoaderCircle class="w-3 h-3 animate-spin" />
								</Show>
							</Button>
						</Show>
						<Show when={props.assignee.isOverride} fallback={<ConfigCardDeleteButton onDelete={props.onRemove} isDeleting={props.isRemoving} alwaysVisible />}>
							<Button
								variant="ghost"
								size="icon"
								class="h-7 w-7 text-muted-foreground hover:text-red-600 hover:bg-red-100 dark:hover:bg-red-950/50"
								onClick={(e) => {
									e.stopPropagation();
									props.onClearOverride();
								}}
								disabled={props.isClearingOverride}
							>
								<Show when={props.isClearingOverride} fallback={<X class="w-4 h-4" />}>
									<LoaderCircle class="w-4 h-4 animate-spin" />
								</Show>
							</Button>
						</Show>
					</ConfigCardActions>
				</ConfigCardRow>
			</ConfigCard>
		</div>
	);
}

function AssigneesEmptyState() {
	return (
		<Card class="flex flex-col items-center justify-center py-6 border-dashed">
			<Users class="w-6 h-6 text-muted-foreground mb-2" />
			<p class="text-sm text-muted-foreground">No assignees in this rotation yet</p>
		</Card>
	);
}

// --- Add Assignee Picker ---

interface AddAssigneePickerContentProps {
	onSelect: (entity: SlackEntity) => void;
	isAdding: Accessor<boolean>;
	existingAssigneeIds: string[];
}

function AddAssigneePickerContent(props: AddAssigneePickerContentProps) {
	const getIntegrationsFn = useServerFn(getIntegrations);
	const integrationsQuery = useQuery(() => ({
		queryKey: ["integrations"],
		queryFn: getIntegrationsFn,
		staleTime: 60_000,
	}));

	return (
		<Show
			when={integrationsQuery.data?.some((i) => i.platform === "slack" && i.installedAt)}
			fallback={
				<div class="flex flex-col items-center justify-center py-6 px-4 text-center">
					<div class="relative mb-3">
						<div class="absolute inset-0 bg-amber-400/20 rounded-full blur-lg animate-pulse" />
						<div class="relative p-2 rounded-full bg-gradient-to-br from-amber-100 to-amber-50 border border-amber-200/60">
							<Link2 class="w-5 h-5 text-amber-600" />
						</div>
					</div>
					<h4 class="text-xs font-medium text-foreground mb-1">No Slack integration</h4>
					<p class="text-xs text-muted-foreground mb-3">Connect Slack to add team members.</p>
					<Button as={Link} to="/config/integrations" variant="outline" size="sm" class="h-7 text-xs cursor-pointer">
						Connect
					</Button>
				</div>
			}
		>
			<SlackEntityPicker
				onSelect={props.onSelect}
				disabled={props.isAdding()}
				placeholder="Search users..."
				emptyMessage="No users available."
				excludeId={(id) => props.existingAssigneeIds.includes(id)}
				mode="users"
			/>
		</Show>
	);
}

// --- Skeleton ---

function RotationContentSkeleton() {
	return (
		<div class="space-y-6">
			<Skeleton class="h-10 w-36" />
			<div class="space-y-3">
				<RotationCardSkeleton />
				<RotationCardSkeleton />
			</div>
			<Skeleton variant="text" class="h-4 w-32" />
		</div>
	);
}

function RotationCardSkeleton() {
	return (
		<div class="border border-border rounded-lg bg-muted/30 p-4">
			<div class="flex items-center gap-3">
				<Skeleton variant="circular" class="w-10 h-10" />
				<div class="flex-1 space-y-1.5">
					<Skeleton variant="text" class="h-4 w-32" />
					<Skeleton variant="text" class="h-3 w-24" />
				</div>
				<Skeleton class="h-8 w-8 rounded" />
			</div>
		</div>
	);
}

// --- Empty State ---

function RotationEmptyState() {
	return (
		<div class="flex flex-col items-center justify-center py-12 border border-dashed border-border rounded-lg">
			<div class="relative mb-4">
				<div class="absolute inset-0 bg-violet-400/20 rounded-full blur-xl animate-pulse" />
				<div class="relative p-3 rounded-full bg-gradient-to-br from-violet-100 to-violet-50 border border-violet-200/60">
					<RefreshCw class="w-8 h-8 text-violet-600" />
				</div>
			</div>
			<h3 class="text-lg font-medium text-foreground mb-1">No rotations yet</h3>
			<p class="text-sm text-muted-foreground text-center max-w-sm">Create a rotation schedule to automatically rotate on-call assignments among team members.</p>
		</div>
	);
}
