import { ChevronDown, ChevronUp, Clock, GripVertical, LoaderCircle, Plus, RefreshCw, Users, X } from "lucide-solid";
import { type Accessor, createEffect, createMemo, createSignal, For, Show, Suspense } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { EntityPicker } from "~/components/EntityPicker";
import { UserAvatar } from "~/components/UserAvatar";
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
import { Skeleton } from "~/components/ui/skeleton";
import type { getRotations } from "~/lib/rotations/rotations";
import {
	toAddAssigneeInput,
	useAddRotationAssignee,
	useClearRotationOverride,
	useRemoveRotationAssignee,
	useReorderRotationAssignee,
	useSetRotationOverride,
} from "~/lib/rotations/rotations.hooks";
import { useUsers } from "~/lib/users/users.hooks";

// --- Types ---

type Rotation = Awaited<ReturnType<typeof getRotations>>[number];

// --- Helpers ---

export function formatShiftLength(interval: string) {
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

export interface RotationCardProps {
	rotation: Rotation;
	isExpanded: boolean;
	onToggle: () => void;
	onDelete: () => void;
}

export function RotationCard(props: RotationCardProps) {
	const addAssigneeMutation = useAddRotationAssignee();
	const removeAssigneeMutation = useRemoveRotationAssignee();
	const reorderMutation = useReorderRotationAssignee();
	const overrideMutation = useSetRotationOverride();
	const clearOverrideMutation = useClearRotationOverride();
	const usersQuery = useUsers();

	const [isAddingAssignee, setIsAddingAssignee] = createSignal(false);

	const currentAssignee = () => props.rotation.assignees.find((a) => a.isOverride) ?? props.rotation.assignees.find((a) => a.isBaseAssignee);

	const currentAssigneeUser = createMemo(() => {
		const assignee = currentAssignee();
		if (!assignee) return undefined;
		return usersQuery.data?.find((u) => u.id === assignee.id);
	});

	const handleSelectAssignee = (user: { id: string; name: string; avatar?: string | null; disabled?: boolean }) => {
		if (user.disabled) return;
		addAssigneeMutation.mutate(toAddAssigneeInput(props.rotation.id, { id: user.id, name: user.name, avatar: user.avatar ?? undefined }));
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
					when={currentAssigneeUser()}
					fallback={
						<ConfigCardIcon variant="violet" size="sm">
							<RefreshCw class="w-4 h-4" />
						</ConfigCardIcon>
					}
				>
					{(user) => <UserAvatar name={() => user().name} avatar={() => user().image ?? undefined} />}
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
						<ConfigCardDeleteButton onDelete={props.onDelete} alwaysVisible disabledReason={props.rotation.isInUse ? "Used in an entry point" : undefined} />
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
						teamId={props.rotation.teamId}
					/>
				</ConfigCardExpandedContent>
			</Show>
		</ConfigCard>
	);
}

// --- Subcomponents ---

function RotationAssigneesSection(props: {
	assignees: Rotation["assignees"];
	isAddingAssignee: boolean;
	onStartAdding: () => void;
	onCancelAdding: () => void;
	onSelectAssignee: (entity: { id: string; name: string; avatar?: string | null }) => void;
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
	teamId?: string | null;
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
						<AddAssigneePickerContent
							onSelect={props.onSelectAssignee}
							isAdding={() => props.isAdding}
							existingAssigneeIds={props.assignees.map((a) => a.id)}
							teamId={props.teamId}
						/>
					</Suspense>
				</Card>
			</Show>

			<Show
				when={assignees.length > 0}
				fallback={
					<Show when={!props.isAddingAssignee}>
						<AssigneesEmptyState />
					</Show>
				}
			>
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
	const usersQuery = useUsers();
	const user = createMemo(() => usersQuery.data?.find((u) => u.id === props.assignee.id));

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

					<Show when={user()} fallback={<Skeleton variant="circular" class="w-8 h-8" />}>
						{(u) => <UserAvatar name={() => u().name} avatar={() => u().image ?? undefined} />}
					</Show>
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

// --- Empty States ---

export function RotationEmptyState() {
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

function AssigneesEmptyState() {
	return (
		<Card class="flex flex-col items-center justify-center py-6 border-dashed">
			<Users class="w-6 h-6 text-muted-foreground mb-2" />
			<p class="text-sm text-muted-foreground">No assignees in this rotation yet</p>
		</Card>
	);
}

// --- Pickers ---

interface AddAssigneePickerContentProps {
	onSelect: (entity: { id: string; name: string; avatar?: string | null }) => void;
	isAdding: Accessor<boolean>;
	existingAssigneeIds: string[];
	teamId?: string | null;
}

function AddAssigneePickerContent(props: AddAssigneePickerContentProps) {
	const usersQuery = useUsers();

	const entities = createMemo(() => {
		const users = usersQuery.data ?? [];
		const filteredUsers = props.teamId ? users.filter((u) => u.teamIds.includes(props.teamId!)) : users;

		return filteredUsers.map((u) => ({
			id: u.id,
			name: u.name,
			avatar: u.image,
			disabled: u.disabled,
			disabledReason: u.disabled ? "Missing Slack integration" : undefined,
		}));
	});

	return (
		<EntityPicker
			entities={entities}
			onSelect={props.onSelect}
			disabled={props.isAdding()}
			placeholder="Search users..."
			emptyMessage={props.teamId ? "No team members available." : "No users available."}
			excludeId={(id) => props.existingAssigneeIds.includes(id)}
		/>
	);
}

// --- Skeletons ---

export function RotationCardSkeleton() {
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
