import { SHIFT_LENGTH_OPTIONS } from "@fire/common";
import { useQuery } from "@tanstack/solid-query";
import { createFileRoute, Link } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { Check, ChevronLeft, ChevronRight, ExternalLink, GripVertical, LoaderCircle, Pencil, Plus, Trash2, Users as UsersIcon, X } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, onCleanup, Show, Suspense } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { EntityPicker } from "~/components/EntityPicker";
import { UserAvatar } from "~/components/UserAvatar";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { ConfigCard, ConfigCardActions, ConfigCardContent, ConfigCardDeleteButton, ConfigCardRow, ConfigCardTitle } from "~/components/ui/config-card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Skeleton } from "~/components/ui/skeleton";
import { requireRoutePermission } from "~/lib/auth/route-guards";
import { runDemoAware } from "~/lib/demo/runtime";
import { getSlackSelectableChannelsDemo } from "~/lib/demo/store";
import { getRotationSelectableSlackChannels, type getRotations } from "~/lib/rotations/rotations";
import {
	toAddAssigneeInput,
	toAddSlackUserAssigneeInput,
	useAddRotationAssignee,
	useAddSlackUserAsRotationAssignee,
	useClearRotationOverride,
	useCreateRotationOverride,
	useRemoveRotationAssignee,
	useReorderRotationAssignee,
	useRotationOverrides,
	useRotations,
	useUpdateRotationAnchor,
	useUpdateRotationName,
	useUpdateRotationOverride,
	useUpdateRotationShiftLength,
	useUpdateRotationSlackChannel,
	useUpdateRotationTeam,
} from "~/lib/rotations/rotations.hooks";
import { useTeams } from "~/lib/teams/teams.hooks";
import { usePossibleSlackUsers, useUsers } from "~/lib/users/users.hooks";
import { cn } from "~/lib/utils/client";

export const Route = createFileRoute("/_authed/rotations/$rotationId")({
	beforeLoad: requireRoutePermission("catalog.read"),
	component: RotationDetailsPage,
});

type Rotation = Awaited<ReturnType<typeof getRotations>>[number];

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MIN_OVERRIDE_MS = 15 * 60 * 1000;
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const ALL_OVERRIDES_START = new Date("1970-01-01T00:00:00.000Z");
const ALL_OVERRIDES_END = new Date("9999-12-31T23:59:59.999Z");

function RotationDetailsPage() {
	const params = Route.useParams();
	const rotationsQuery = useRotations();

	const rotationId = createMemo(() => params().rotationId);
	const rotation = createMemo(() => rotationsQuery.data?.find((r) => r.id === rotationId()));

	return (
		<div class="flex-1 bg-background p-6 md:p-8">
			<div class="max-w-6xl mx-auto space-y-6">
				<Suspense fallback={<RotationDetailsSkeleton />}>
					<Show when={rotation()} fallback={<RotationNotFound />}>
						{(data) => (
							<>
								<RotationHeader rotation={data()} />
								<div class="grid gap-6 lg:grid-cols-[320px_1fr]">
									<RotationAssigneesPanel rotation={data()} />
									<RotationSchedulePanel rotation={data()} />
								</div>
							</>
						)}
					</Show>
				</Suspense>
			</div>
		</div>
	);
}

function RotationHeader(props: { rotation: Rotation }) {
	const teamsQuery = useTeams();
	const usersQuery = useUsers();
	const updateNameMutation = useUpdateRotationName({
		onMutate: () => setIsEditingName(false),
	});
	const updateShiftLengthMutation = useUpdateRotationShiftLength();
	const updateAnchorMutation = useUpdateRotationAnchor();
	const updateTeamMutation = useUpdateRotationTeam();
	const updateSlackChannelMutation = useUpdateRotationSlackChannel();
	const getSlackBotChannelsFn = useServerFn(getRotationSelectableSlackChannels);
	const slackChannelsQuery = useQuery(() => ({
		queryKey: ["rotation-slack-selectable-channels"],
		queryFn: () =>
			runDemoAware({
				demo: () => getSlackSelectableChannelsDemo(),
				remote: () => getSlackBotChannelsFn(),
			}),
		staleTime: Infinity,
	}));

	const [isEditingName, setIsEditingName] = createSignal(false);
	const [name, setName] = createSignal(props.rotation.name);
	const [isEditingAnchor, setIsEditingAnchor] = createSignal(false);
	const [anchorInput, setAnchorInput] = createSignal("");

	const NO_TEAM_VALUE = "none";
	const NO_CHANNEL_VALUE = "none";
	const teamOptions = createMemo(() => [NO_TEAM_VALUE, ...(teamsQuery.data?.map((t) => t.id) ?? [])]);
	const teamsById = createMemo(() => new Map(teamsQuery.data?.map((t) => [t.id, t]) ?? []));
	const slackChannelsById = createMemo(() => new Map((slackChannelsQuery.data ?? []).map((channel) => [channel.id, channel])));
	const channelOptions = createMemo(() => {
		const channelIds = slackChannelsQuery.data?.map((channel) => channel.id) ?? [];
		if (props.rotation.slackChannelId && !channelIds.includes(props.rotation.slackChannelId)) {
			return [NO_CHANNEL_VALUE, props.rotation.slackChannelId, ...channelIds];
		}
		return [NO_CHANNEL_VALUE, ...channelIds];
	});
	const team = createMemo(() => (props.rotation.teamId ? teamsById().get(props.rotation.teamId) : undefined));
	const eligibleTeamIds = createMemo(() => {
		if (!teamsQuery.data || !usersQuery.data) {
			return new Set<string>();
		}
		if (props.rotation.assignees.length === 0) {
			return new Set(teamsQuery.data.map((t) => t.id));
		}
		const usersById = new Map(usersQuery.data.map((user) => [user.id, user]));
		const eligible = new Set<string>();
		for (const team of teamsQuery.data) {
			const hasAllMembers = props.rotation.assignees.every((assignee) => usersById.get(assignee.id)?.teams.some((membership) => membership.id === team.id));
			if (hasAllMembers) {
				eligible.add(team.id);
			}
		}
		return eligible;
	});
	const currentTeamValue = createMemo(() => props.rotation.teamId ?? NO_TEAM_VALUE);
	const currentSlackChannelValue = createMemo(() => props.rotation.slackChannelId ?? NO_CHANNEL_VALUE);
	const currentShiftLength = createMemo(() => normalizeShiftLength(props.rotation.shiftLength));

	createEffect(() => {
		if (props.rotation.shiftStart) {
			setAnchorInput(formatDateTimeLocal(props.rotation.shiftStart));
		}
	});

	const formattedAnchor = createMemo(() => {
		if (!props.rotation.shiftStart) return "Not set";
		return new Date(props.rotation.shiftStart).toLocaleDateString(undefined, {
			weekday: "short",
			month: "short",
			day: "numeric",
			hour: "numeric",
			minute: "2-digit",
		});
	});

	const handleUpdateName = () => {
		const trimmed = name().trim();
		if (!trimmed || trimmed === props.rotation.name) {
			setIsEditingName(false);
			return;
		}
		updateNameMutation.mutate({ id: props.rotation.id, name: trimmed });
	};

	const handleShiftLengthChange = (value: string | null) => {
		if (!value || value === props.rotation.shiftLength) return;
		updateShiftLengthMutation.mutate({ id: props.rotation.id, shiftLength: value });
	};

	const handleTeamChange = (value: string | null) => {
		if (!value) return;
		const nextTeamId = value === NO_TEAM_VALUE ? null : value;
		const currentTeamId = props.rotation.teamId ?? null;
		if (nextTeamId === currentTeamId) return;
		updateTeamMutation.mutate({ id: props.rotation.id, teamId: nextTeamId });
	};

	const handleSlackChannelChange = (value: string | null) => {
		if (!value) return;
		const nextChannelId = value === NO_CHANNEL_VALUE ? null : value;
		const currentChannelId = props.rotation.slackChannelId ?? null;
		if (nextChannelId === currentChannelId) return;
		updateSlackChannelMutation.mutate({ id: props.rotation.id, slackChannelId: nextChannelId });
	};

	const handleAnchorSave = () => {
		const parsed = parseDateTimeLocal(anchorInput());
		if (!parsed) return;
		updateAnchorMutation.mutate({ id: props.rotation.id, anchorAt: parsed });
		setIsEditingAnchor(false);
	};

	const handleAnchorCancel = () => {
		if (props.rotation.shiftStart) {
			setAnchorInput(formatDateTimeLocal(props.rotation.shiftStart));
		}
		setIsEditingAnchor(false);
	};

	return (
		<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
			<div class="space-y-1">
				<div class="flex flex-wrap items-center gap-2">
					<Show
						when={isEditingName()}
						fallback={
							<button type="button" class="flex items-center gap-2 group/title cursor-pointer bg-transparent border-none p-0" onClick={() => setIsEditingName(true)}>
								<h1 class="text-2xl font-bold tracking-tight">{props.rotation.name}</h1>
								<Pencil class="w-4 h-4 text-muted-foreground opacity-0 group-hover/title:opacity-100 transition-opacity" />
							</button>
						}
					>
						<form
							class="flex items-center gap-2"
							onSubmit={(e) => {
								e.preventDefault();
								handleUpdateName();
							}}
							onFocusOut={(e) => {
								if (!e.currentTarget.contains(e.relatedTarget as Node) && !updateNameMutation.isPending) {
									setIsEditingName(false);
								}
							}}
							onKeyDown={(e) => {
								if (e.key === "Escape") {
									setIsEditingName(false);
								}
							}}
						>
							<Input value={name()} onInput={(e) => setName(e.currentTarget.value)} class="h-9 text-lg font-bold w-full max-w-sm" autofocus />
							<Button size="sm" type="submit" disabled={updateNameMutation.isPending || !name().trim()}>
								<Check class="w-4 h-4" />
							</Button>
						</form>
					</Show>

					<Select
						value={currentShiftLength()}
						onChange={handleShiftLengthChange}
						options={SHIFT_LENGTH_OPTIONS.map((o) => o.value)}
						itemComponent={(itemProps) => <SelectItem item={itemProps.item}>{SHIFT_LENGTH_OPTIONS.find((o) => o.value === itemProps.item.rawValue)?.label}</SelectItem>}
						disabled={updateShiftLengthMutation.isPending}
					>
						<SelectTrigger class="h-auto py-0.5 px-2.5 text-xs font-normal border-border bg-transparent hover:bg-muted/50 w-auto gap-1 [&>svg]:w-3 [&>svg]:h-3">
							<SelectValue<string>>{(state) => SHIFT_LENGTH_OPTIONS.find((o) => o.value === state.selectedOption())?.label}</SelectValue>
						</SelectTrigger>
						<SelectContent />
					</Select>
					<Show
						when={!isEditingAnchor()}
						fallback={
							<div class="flex items-center gap-2">
								<Input
									type="datetime-local"
									value={anchorInput()}
									onInput={(e) => setAnchorInput(e.currentTarget.value)}
									class="h-7 text-xs w-auto"
									disabled={updateAnchorMutation.isPending}
									onKeyDown={(e) => {
										if (e.key === "Escape") handleAnchorCancel();
										if (e.key === "Enter") handleAnchorSave();
									}}
									autofocus
								/>
								<Button size="sm" class="h-7 px-2" onClick={handleAnchorSave} disabled={updateAnchorMutation.isPending || !anchorInput()}>
									<Show when={updateAnchorMutation.isPending} fallback={<Check class="w-3.5 h-3.5" />}>
										<LoaderCircle class="w-3.5 h-3.5 animate-spin" />
									</Show>
								</Button>
								<Button variant="ghost" size="sm" class="h-7 px-2" onClick={handleAnchorCancel} disabled={updateAnchorMutation.isPending}>
									<X class="w-3.5 h-3.5" />
								</Button>
							</div>
						}
					>
						<button
							type="button"
							class="text-xs text-muted-foreground hover:text-foreground cursor-pointer bg-transparent border-none p-0 inline-flex items-center gap-1.5 group"
							onClick={() => setIsEditingAnchor(true)}
						>
							<span>Shift started</span>
							<span class="font-medium text-foreground">{formattedAnchor()}</span>
							<Pencil class="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
						</button>
					</Show>
				</div>
				<div class="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
					<UsersIcon class="w-4 h-4" />
					<Select
						value={currentTeamValue()}
						onChange={handleTeamChange}
						options={teamOptions()}
						optionDisabled={(option) => option !== NO_TEAM_VALUE && !eligibleTeamIds().has(option)}
						itemComponent={(itemProps) => {
							const teamId = itemProps.item.rawValue;
							const isDisabled = itemProps.item.disabled;
							if (teamId === NO_TEAM_VALUE) {
								return <SelectItem item={itemProps.item}>No team</SelectItem>;
							}
							return (
								<SelectItem item={itemProps.item} class={isDisabled ? "opacity-50" : ""}>
									<div class="flex flex-col gap-0.5">
										<span>{teamsById().get(teamId)?.name ?? "Unknown team"}</span>
										<Show when={isDisabled}>
											<span class="text-[10px] text-muted-foreground">At least one member is not in this team</span>
										</Show>
									</div>
								</SelectItem>
							);
						}}
						disabled={!teamsQuery.data || !usersQuery.data || updateTeamMutation.isPending}
					>
						<SelectTrigger class="h-auto py-0.5 px-2.5 text-xs font-normal border-border bg-transparent hover:bg-muted/50 w-auto gap-1 [&>svg]:w-3 [&>svg]:h-3">
							<SelectValue<string>>
								{(state) => {
									const selected = state.selectedOption();
									if (!selected || selected === NO_TEAM_VALUE) return "No team";
									return teamsById().get(selected)?.name ?? (teamsQuery.data ? "Unknown team" : "Loading teams...");
								}}
							</SelectValue>
						</SelectTrigger>
						<SelectContent />
					</Select>
					<Show when={team()}>
						{(t) => (
							<Link to="/teams/$teamId" params={{ teamId: t().id }} target="_blank" class="text-muted-foreground hover:text-foreground" title="Open team">
								<ExternalLink class="w-3.5 h-3.5" />
							</Link>
						)}
					</Show>
					<Select
						value={currentSlackChannelValue()}
						onChange={handleSlackChannelChange}
						options={channelOptions()}
						itemComponent={(itemProps) => {
							const channelId = itemProps.item.rawValue;
							if (channelId === NO_CHANNEL_VALUE) {
								return <SelectItem item={itemProps.item}>No Slack channel</SelectItem>;
							}
							const channel = slackChannelsById().get(channelId);
							return (
								<SelectItem item={itemProps.item}>{channel ? `#${channel.name}${channel.isMember ? "" : " (bot will auto-join)"}` : `Unknown channel (${channelId})`}</SelectItem>
							);
						}}
						disabled={updateSlackChannelMutation.isPending || slackChannelsQuery.isPending}
					>
						<SelectTrigger class="h-auto py-0.5 px-2.5 text-xs font-normal border-border bg-transparent hover:bg-muted/50 w-auto gap-1 [&>svg]:w-3 [&>svg]:h-3">
							<SelectValue<string>>
								{(state) => {
									const selected = state.selectedOption();
									if (!selected || selected === NO_CHANNEL_VALUE) return "No Slack channel";
									const channel = slackChannelsById().get(selected);
									if (!channel) return `Unknown channel (${selected})`;
									return `#${channel.name}`;
								}}
							</SelectValue>
						</SelectTrigger>
						<SelectContent />
					</Select>
				</div>
			</div>
		</div>
	);
}

function RotationAssigneesPanel(props: { rotation: Rotation }) {
	const addAssigneeMutation = useAddRotationAssignee();
	const addSlackUserAsAssigneeMutation = useAddSlackUserAsRotationAssignee();
	const removeAssigneeMutation = useRemoveRotationAssignee();
	const reorderMutation = useReorderRotationAssignee();

	const [isAddingAssignee, setIsAddingAssignee] = createSignal(false);
	const [assignees, setAssignees] = createStore<Rotation["assignees"]>([]);
	const [draggedId, setDraggedId] = createSignal<string | null>(null);
	const [dropTargetIndex, setDropTargetIndex] = createSignal<number | null>(null);

	createEffect(() => {
		setAssignees(reconcile(props.rotation.assignees, { key: "id" }));
	});

	const handleSelectAssignee = (user: { id: string; name: string; avatar?: string | null; type: "user" | "slack" }) => {
		if (user.type === "user") {
			addAssigneeMutation.mutate(toAddAssigneeInput(props.rotation.id, { id: user.id, name: user.name, avatar: user.avatar ?? undefined }));
		} else {
			addSlackUserAsAssigneeMutation.mutate(toAddSlackUserAssigneeInput(props.rotation.id, { id: user.id, name: user.name, avatar: user.avatar ?? undefined }));
		}
		setIsAddingAssignee(false);
	};

	const handleDragStart = (assigneeId: string) => {
		setDraggedId(assigneeId);
	};

	const handleDragEnd = () => {
		const draggedAssigneeId = draggedId();
		const targetIndex = dropTargetIndex();

		if (draggedAssigneeId && targetIndex !== null) {
			const currentIndex = assignees.findIndex((a) => a.id === draggedAssigneeId);
			if (currentIndex !== -1 && currentIndex !== targetIndex) {
				reorderMutation.mutate({ rotationId: props.rotation.id, assigneeId: draggedAssigneeId, newPosition: targetIndex });
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
		<div class="space-y-3">
			<div class="flex items-center justify-between">
				<span class="text-sm font-medium text-muted-foreground">Rotation Order</span>
				<Show when={!isAddingAssignee()}>
					<Button variant="ghost" size="sm" class="h-7 text-xs" onClick={() => setIsAddingAssignee(true)}>
						<Plus class="w-3 h-3" />
						Add
					</Button>
				</Show>
			</div>

			<Show when={isAddingAssignee()}>
				<div class="rounded-lg border border-border overflow-hidden">
					<header class="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
						<span class="text-xs font-medium text-muted-foreground">Select user to add</span>
						<Button variant="ghost" size="icon" class="h-6 w-6 cursor-pointer" onClick={() => setIsAddingAssignee(false)}>
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
						<AssigneePickerContent
							onSelect={handleSelectAssignee}
							isAdding={() => addAssigneeMutation.isPending || addSlackUserAsAssigneeMutation.isPending}
							existingAssigneeIds={props.rotation.assignees.map((a) => a.id)}
							teamId={props.rotation.teamId}
						/>
					</Suspense>
				</div>
			</Show>

			<Show
				when={assignees.length > 0}
				fallback={
					<Show when={!isAddingAssignee()}>
						<AssigneesEmptyState />
					</Show>
				}
			>
				<div class="space-y-1.5">
					<For each={assignees}>
						{(assignee, index) => (
							<AssigneeRow
								assignee={assignee}
								index={index()}
								onRemove={() => removeAssigneeMutation.mutate({ rotationId: props.rotation.id, assigneeId: assignee.id })}
								isRemoving={removeAssigneeMutation.isPending && removeAssigneeMutation.variables?.assigneeId === assignee.id}
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
		</div>
	);
}

function AssigneeRow(props: {
	assignee: Rotation["assignees"][number];
	index: number;
	onRemove: () => void;
	isRemoving: boolean;
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
						<ConfigCardContent class="min-w-0">
							<ConfigCardTitle class="truncate">{user()?.name}</ConfigCardTitle>
						</ConfigCardContent>
					</Show>

					<Show when={props.assignee.isBaseAssignee}>
						<Badge variant="secondary" class="text-xs font-normal text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400">
							On call
						</Badge>
					</Show>

					<ConfigCardActions animated groupName="assignee">
						<ConfigCardDeleteButton onDelete={props.onRemove} isDeleting={props.isRemoving} alwaysVisible />
					</ConfigCardActions>
				</ConfigCardRow>
			</ConfigCard>
		</div>
	);
}

function RotationSchedulePanel(props: { rotation: Rotation }) {
	const usersQuery = useUsers();

	const rangeOptions = [
		{ label: "1 day", days: 1 },
		{ label: "1 week", days: 7 },
		{ label: "2 weeks", days: 14 },
		{ label: "4 weeks", days: 28 },
	] as const;

	const [rangeDays, setRangeDays] = createSignal<number>(rangeOptions[1].days);
	const [viewMode, setViewMode] = createSignal<"timeline" | "calendar">("timeline");
	const [viewAnchor, setViewAnchor] = createSignal(startOfDay(new Date()));
	const selectedRange = createMemo(() => rangeOptions.find((option) => option.days === rangeDays()) ?? rangeOptions[1]);
	const calendarMonthStart = createMemo(() => startOfMonth(viewAnchor()));
	const isCalendarView = createMemo(() => viewMode() === "calendar");
	const calendarMonthEnd = createMemo(() => addMonths(calendarMonthStart(), 1));
	const calendarGridStart = createMemo(() => startOfWeek(calendarMonthStart()));
	const calendarGridEnd = createMemo(() => endOfWeek(addDays(calendarMonthEnd(), -1)));
	const viewStart = createMemo(() => (viewMode() === "calendar" ? calendarMonthStart() : viewAnchor()));
	const viewEnd = createMemo(() => {
		if (viewMode() === "calendar") {
			return addMonths(calendarMonthStart(), 1);
		}
		return new Date(viewAnchor().getTime() + rangeDays() * DAY_MS);
	});
	const scheduleStart = createMemo(() => (isCalendarView() ? calendarGridStart() : viewStart()));
	const scheduleEnd = createMemo(() => (isCalendarView() ? addDays(calendarGridEnd(), 1) : viewEnd()));

	const overridesQuery = useRotationOverrides({
		rotationId: () => props.rotation.id,
		startAt: () => ALL_OVERRIDES_START,
		endAt: () => ALL_OVERRIDES_END,
	});

	const usersById = createMemo(() => {
		return new Map(usersQuery.data?.map((u) => [u.id, u]) ?? []);
	});

	const assigneeColorById = createMemo(() => {
		const colors = [
			"bg-blue-100 text-blue-800 border-blue-200",
			"bg-emerald-100 text-emerald-800 border-emerald-200",
			"bg-amber-100 text-amber-800 border-amber-200",
			"bg-violet-100 text-violet-800 border-violet-200",
			"bg-rose-100 text-rose-800 border-rose-200",
			"bg-sky-100 text-sky-800 border-sky-200",
		];
		const map = new Map<string, string>();
		props.rotation.assignees.forEach((assignee, index) => {
			map.set(assignee.id, colors[index % colors.length]);
		});
		return map;
	});

	const normalizedOverrides = createMemo<RotationOverrideSegment[]>(() => {
		return (overridesQuery.data ?? [])
			.map((override) => ({
				id: override.id,
				assigneeId: override.assigneeId,
				start: new Date(override.startAt),
				end: new Date(override.endAt),
				createdAt: new Date(override.createdAt),
			}))
			.filter((override) => {
				const startAt = override.start.getTime();
				const endAt = override.end.getTime();
				return !Number.isNaN(startAt) && !Number.isNaN(endAt) && endAt > startAt;
			});
	});

	const scheduleOverrides = createMemo(() => normalizedOverrides().filter((override) => override.start < scheduleEnd() && override.end > scheduleStart()));

	const overridesByPriority = createMemo(() => [...scheduleOverrides()].sort((a, b) => compareOverridePriority(b, a)));

	const baseSegments = createMemo(() => {
		if (!props.rotation.assignees.length) return [];
		const shiftMs = parseShiftLengthMs(props.rotation.shiftLength);
		if (!shiftMs) return [];

		const shiftStart = props.rotation.shiftStart ? new Date(props.rotation.shiftStart) : new Date();
		return buildBaseSegments({
			assignees: props.rotation.assignees,
			shiftStart,
			shiftMs,
			viewStart: scheduleStart(),
			viewEnd: scheduleEnd(),
		});
	});

	const timelineBaseSegments = createMemo(() => {
		const overrides = scheduleOverrides();
		return baseSegments().map((segment) => ({
			...segment,
			inactiveRanges: collectOverlapRanges(
				segment,
				overrides.filter((override) => override.assigneeId !== segment.assigneeId),
			),
		}));
	});

	const calendarDays = createMemo(() => {
		const days: Date[] = [];
		for (let day = calendarGridStart(); day <= calendarGridEnd(); day = addDays(day, 1)) {
			days.push(new Date(day));
		}
		return days;
	});
	const calendarMonthLabel = createMemo(() =>
		calendarMonthStart().toLocaleDateString(undefined, {
			month: "long",
			year: "numeric",
		}),
	);
	const timelineRangeLabel = createMemo(() => {
		const start = viewStart();
		const end = addDays(viewEnd(), -1);
		const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
		const startText = start.toLocaleDateString(undefined, { day: "numeric", month: "short" });
		const endText = end.toLocaleDateString(undefined, { day: "numeric", month: "short" });
		if (sameMonth) {
			return `${startText} - ${end.getDate()}`;
		}
		return `${startText} - ${endText}`;
	});
	const calendarAssigneeByDay = createMemo(() => {
		const segments = baseSegments();
		const overrides = overridesByPriority();
		const map = new Map<string, string | undefined>();
		for (const day of calendarDays()) {
			const dayStart = startOfDay(day);
			map.set(dayStart.toDateString(), getCalendarDayAssigneeId(dayStart, segments, overrides));
		}
		return map;
	});

	const totalDays = createMemo(() => Math.max(1, Math.ceil((viewEnd().getTime() - viewStart().getTime()) / DAY_MS)));
	const dayLabels = createMemo(() => Array.from({ length: totalDays() }, (_, index) => new Date(viewStart().getTime() + index * DAY_MS)));

	const overrideLayout = createMemo(() => {
		const overrides = scheduleOverrides().filter((override) => override.start < viewEnd() && override.end > viewStart());
		const prioritizedOverrides = [...overrides].sort((a, b) => compareOverridePriority(b, a));
		const sortedOverrides = [...overrides].sort((a, b) => a.start.getTime() - b.start.getTime());
		const rowEndTimes: Date[] = [];
		const items: (RotationOverrideSegment & { row: number; inactiveRanges: TimeRange[] })[] = [];

		for (const override of sortedOverrides) {
			let row = rowEndTimes.findIndex((end) => end.getTime() <= override.start.getTime());
			if (row === -1) {
				row = rowEndTimes.length;
				rowEndTimes.push(override.end);
			} else {
				rowEndTimes[row] = override.end;
			}

			const higherPriorityOverrides = prioritizedOverrides.filter((candidate) => compareOverridePriority(candidate, override) > 0 && candidate.assigneeId !== override.assigneeId);

			items.push({
				...override,
				row,
				inactiveRanges: collectOverlapRanges(override, higherPriorityOverrides),
			});
		}

		return {
			items,
			rowCount: rowEndTimes.length,
		};
	});

	let timelineRef: HTMLDivElement | undefined;
	const [isSelecting, setIsSelecting] = createSignal(false);
	const [selectionStart, setSelectionStart] = createSignal<Date | null>(null);
	const [selectionEnd, setSelectionEnd] = createSignal<Date | null>(null);
	const [popoverOpen, setPopoverOpen] = createSignal(false);
	const [popoverPosition, setPopoverPosition] = createSignal<{ left: number; width: number } | null>(null);
	const [selectedAssignee, setSelectedAssignee] = createSignal<string | null>(null);
	const [overrideStartInput, setOverrideStartInput] = createSignal("");
	const [overrideEndInput, setOverrideEndInput] = createSignal("");
	const [overrideMode, setOverrideMode] = createSignal<"create" | "edit">("create");
	const [editingOverrideId, setEditingOverrideId] = createSignal<string | null>(null);

	const closePopover = () => {
		setPopoverOpen(false);
		setPopoverPosition(null);
		setSelectedAssignee(null);
		setOverrideStartInput("");
		setOverrideEndInput("");
		setOverrideMode("create");
		setEditingOverrideId(null);
	};

	const resetSelection = () => {
		setIsSelecting(false);
		setSelectionStart(null);
		setSelectionEnd(null);
	};

	const switchView = (mode: "timeline" | "calendar") => {
		if (mode === viewMode()) return;
		resetSelection();
		closePopover();
		setViewMode(mode);
	};

	const createOverrideMutation = useCreateRotationOverride();
	const updateOverrideMutation = useUpdateRotationOverride();

	const clearOverrideMutation = useClearRotationOverride();

	const isSavingOverride = createMemo(() => createOverrideMutation.isPending || updateOverrideMutation.isPending);

	const selectionRange = createMemo(() => {
		const start = selectionStart();
		const end = selectionEnd();
		if (!start || !end) return null;
		return start <= end ? { start, end } : { start: end, end: start };
	});

	const shiftRange = (direction: -1 | 1) => {
		if (viewMode() === "calendar") {
			setViewAnchor(addMonths(calendarMonthStart(), direction));
			return;
		}
		const delta = rangeDays() * DAY_MS * direction;
		setViewAnchor(new Date(viewAnchor().getTime() + delta));
	};

	const parsedOverrideStart = createMemo(() => parseDateTimeLocal(overrideStartInput()));
	const parsedOverrideEnd = createMemo(() => parseDateTimeLocal(overrideEndInput()));
	const isOverrideRangeValid = createMemo(() => {
		const start = parsedOverrideStart();
		const end = parsedOverrideEnd();
		if (!start || !end) return false;
		return end.getTime() > start.getTime();
	});

	const positionToDate = (clientX: number) => {
		if (!timelineRef) return viewStart();
		const rect = timelineRef.getBoundingClientRect();
		const clamped = Math.min(Math.max(clientX - rect.left, 0), rect.width);
		const ratio = rect.width === 0 ? 0 : clamped / rect.width;
		return new Date(viewStart().getTime() + ratio * (viewEnd().getTime() - viewStart().getTime()));
	};

	let cleanupPointerListeners: (() => void) | null = null;
	let dragAnchor: Date | null = null;

	const stopPointerListeners = () => {
		if (cleanupPointerListeners) {
			cleanupPointerListeners();
			cleanupPointerListeners = null;
		}
	};

	onCleanup(() => {
		stopPointerListeners();
	});

	const handlePointerDown = (e: PointerEvent) => {
		if (!props.rotation.assignees.length || !timelineRef) return;
		const target = e.target as HTMLElement | null;
		if (target?.closest('[data-override="true"]')) return;

		const start = floorToHour(positionToDate(e.clientX));
		dragAnchor = start;
		setSelectionStart(start);
		setSelectionEnd(new Date(start.getTime() + HOUR_MS));
		setIsSelecting(true);

		stopPointerListeners();

		const handleMove = (event: PointerEvent) => {
			if (!dragAnchor) return;
			const current = positionToDate(event.clientX);
			const deltaMs = current.getTime() - dragAnchor.getTime();

			if (deltaMs < 0) {
				// Dragging left
				const snappedStart = floorToHour(current);
				setSelectionStart(snappedStart);
				setSelectionEnd(new Date(dragAnchor.getTime() + HOUR_MS));
			} else {
				// Dragging right (or same position)
				setSelectionStart(dragAnchor);
				const hours = Math.max(1, Math.ceil(deltaMs / HOUR_MS));
				setSelectionEnd(new Date(dragAnchor.getTime() + hours * HOUR_MS));
			}
		};

		const handleUp = () => {
			stopPointerListeners();
			finalizeSelection();
		};

		document.addEventListener("pointermove", handleMove);
		document.addEventListener("pointerup", handleUp);
		document.addEventListener("pointercancel", handleUp);
		cleanupPointerListeners = () => {
			document.removeEventListener("pointermove", handleMove);
			document.removeEventListener("pointerup", handleUp);
			document.removeEventListener("pointercancel", handleUp);
		};
	};

	const finalizeSelection = () => {
		stopPointerListeners();
		const range = selectionRange();
		setIsSelecting(false);
		setSelectionStart(null);
		setSelectionEnd(null);
		dragAnchor = null;

		if (!range) return;
		if (range.end.getTime() - range.start.getTime() < MIN_OVERRIDE_MS) return;

		const totalMs = viewEnd().getTime() - viewStart().getTime();
		const left = ((range.start.getTime() - viewStart().getTime()) / totalMs) * 100;
		const width = ((range.end.getTime() - range.start.getTime()) / totalMs) * 100;

		setOverrideStartInput(formatDateTimeLocal(range.start));
		setOverrideEndInput(formatDateTimeLocal(range.end));
		setOverrideMode("create");
		setEditingOverrideId(null);
		setSelectedAssignee(null);
		setPopoverPosition({ left, width });
		setPopoverOpen(true);
	};

	const handleSaveOverride = () => {
		const start = parsedOverrideStart();
		const end = parsedOverrideEnd();
		const assigneeId = selectedAssignee();
		if (!start || !end || !assigneeId || end.getTime() <= start.getTime()) return;
		closePopover();
		if (overrideMode() === "edit") {
			const overrideId = editingOverrideId();
			if (!overrideId) return;
			updateOverrideMutation.mutate({
				rotationId: props.rotation.id,
				overrideId,
				assigneeId,
				startAt: start,
				endAt: end,
			});
			return;
		}
		createOverrideMutation.mutate({
			rotationId: props.rotation.id,
			assigneeId,
			startAt: start,
			endAt: end,
		});
	};

	const openEditOverride = (override: { id: string; start: Date; end: Date; assigneeId: string }) => {
		const totalMs = viewEnd().getTime() - viewStart().getTime();
		const left = ((override.start.getTime() - viewStart().getTime()) / totalMs) * 100;
		const width = ((override.end.getTime() - override.start.getTime()) / totalMs) * 100;

		setOverrideStartInput(formatDateTimeLocal(override.start));
		setOverrideEndInput(formatDateTimeLocal(override.end));
		setSelectedAssignee(override.assigneeId);
		setOverrideMode("edit");
		setEditingOverrideId(override.id);
		setPopoverPosition({ left, width });
		setPopoverOpen(true);
	};

	const assigneeEntities = createMemo(() => {
		return props.rotation.assignees.map((assignee) => {
			const user = usersById().get(assignee.id);
			return {
				id: assignee.id,
				name: user?.name ?? "Unknown user",
				avatar: user?.image ?? undefined,
			};
		});
	});

	const goToToday = () => {
		const today = new Date();
		setViewAnchor(startOfDay(today));
	};

	const dayInterval = createMemo(() => {
		const days = rangeDays();
		if (days >= 28) return 4;
		if (days >= 14) return 2;
		return 1;
	});

	const visibleDayLabels = createMemo(() => {
		const interval = dayInterval();
		return dayLabels().filter((_, i) => i % interval === 0);
	});

	const isHourView = createMemo(() => rangeDays() === 1);

	const hourLabels = createMemo(() => {
		if (!isHourView()) return [];
		const hours: Date[] = [];
		for (let h = 0; h < 24; h += 3) {
			hours.push(new Date(viewStart().getTime() + h * HOUR_MS));
		}
		return hours;
	});

	const gridColumns = createMemo(() => (isHourView() ? 24 : totalDays()));

	return (
		<div class="space-y-4">
			<div class="flex items-center justify-between gap-4">
				<div class="flex items-center gap-1">
					<Button variant="outline" size="sm" onClick={goToToday} class="text-xs">
						Today
					</Button>
					<Button variant="ghost" size="icon" class="h-8 w-8" onClick={() => shiftRange(-1)}>
						<ChevronLeft class="w-4 h-4" />
					</Button>
					<Button variant="ghost" size="icon" class="h-8 w-8" onClick={() => shiftRange(1)}>
						<ChevronRight class="w-4 h-4" />
					</Button>
					<Show when={isCalendarView()}>
						<span class="ml-2 text-sm font-medium text-muted-foreground">{calendarMonthLabel()}</span>
					</Show>
					<Show when={!isCalendarView()}>
						<span class="ml-2 text-sm font-medium text-muted-foreground">{timelineRangeLabel()}</span>
					</Show>
				</div>
				<div class="flex-1" />
				<div class="flex items-center gap-2">
					<Show when={!isCalendarView()}>
						<Select
							value={String(rangeDays())}
							onChange={(value) => value && setRangeDays(Number(value))}
							options={rangeOptions.map((option) => String(option.days))}
							itemComponent={(selectItemProps) => (
								<SelectItem item={selectItemProps.item}>{rangeOptions.find((option) => String(option.days) === selectItemProps.item.rawValue)?.label}</SelectItem>
							)}
						>
							<SelectTrigger class="w-28 h-8 text-xs">
								<SelectValue<string>>{() => selectedRange().label}</SelectValue>
							</SelectTrigger>
							<SelectContent />
						</Select>
					</Show>
					<div class="flex items-center rounded-md border border-border/60 bg-muted/30 p-0.5">
						<Button
							variant="ghost"
							size="sm"
							class={cn("h-7 px-2 text-xs", viewMode() === "timeline" && "bg-background text-foreground shadow-sm")}
							onClick={() => switchView("timeline")}
						>
							Timeline
						</Button>
						<Button
							variant="ghost"
							size="sm"
							class={cn("h-7 px-2 text-xs", viewMode() === "calendar" && "bg-background text-foreground shadow-sm")}
							onClick={() => switchView("calendar")}
						>
							Calendar
						</Button>
					</div>
				</div>
			</div>
			<div class="space-y-0">
				<Show
					when={props.rotation.assignees.length > 0}
					fallback={
						<div class="flex flex-col items-center justify-center gap-2 py-16 border border-dashed border-border rounded-lg">
							<UsersIcon class="w-6 h-6 text-muted-foreground" />
							<p class="text-sm text-muted-foreground">Add assignees to see the schedule.</p>
						</div>
					}
				>
					<div class="relative space-y-0">
						<Show
							when={isCalendarView()}
							fallback={
								<>
									<Show
										when={isHourView()}
										fallback={
											<div class="grid text-xs text-muted-foreground" style={{ "grid-template-columns": `repeat(${visibleDayLabels().length}, minmax(0, 1fr))` }}>
												<For each={visibleDayLabels()}>
													{(day, index) => <div class={cn("px-1 py-1.5", index() === 0 && "pl-0")}>{day.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</div>}
												</For>
											</div>
										}
									>
										<div class="grid text-xs text-muted-foreground" style={{ "grid-template-columns": `repeat(${hourLabels().length}, minmax(0, 1fr))` }}>
											<For each={hourLabels()}>
												{(hour, index) => <div class={cn("px-1 py-1.5", index() === 0 && "pl-0")}>{hour.toLocaleTimeString(undefined, { hour: "numeric" })}</div>}
											</For>
										</div>
									</Show>

									{(() => {
										const overrideRows = overrideLayout().rowCount;
										const previewOverrideRows = isSelecting() || popoverOpen() ? 1 : 0;
										const visibleOverrideRows = Math.max(overrideRows, previewOverrideRows);
										const rowHeight = 48;
										const rowGap = 8;
										const baseTop = rowGap;
										const overrideTop = baseTop + rowHeight + rowGap;
										const containerHeight = (1 + visibleOverrideRows) * (rowHeight + rowGap) + rowGap;
										const totalMs = viewEnd().getTime() - viewStart().getTime();

										const now = new Date();
										const nowPosition = ((now.getTime() - viewStart().getTime()) / totalMs) * 100;
										const showNowLine = nowPosition >= 0 && nowPosition <= 100;

										return (
											<div
												ref={timelineRef}
												class="relative rounded-lg border border-border/50 bg-muted/20 overflow-x-clip"
												style={{ height: `${containerHeight}px` }}
												onPointerDown={handlePointerDown}
											>
												<div class="absolute inset-0 grid pointer-events-none" style={{ "grid-template-columns": `repeat(${gridColumns()}, minmax(0, 1fr))` }}>
													<For each={Array.from({ length: gridColumns() })}>{(_, index) => <div class={cn("border-l border-border/30", index() === 0 && "border-l-0")} />}</For>
												</div>

												<Show when={showNowLine}>
													<div class="absolute top-0 bottom-0 z-20 pointer-events-none" style={{ left: `${nowPosition}%` }}>
														<div class="absolute -top-5 left-1/2 -translate-x-1/2 px-1 py-0.5 rounded text-rose-500 text-[10px] font-medium whitespace-nowrap">
															{now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
														</div>
														<div class="absolute top-0 bottom-0 w-px bg-rose-400/70 -translate-x-1/2" />
													</div>
												</Show>

												<For each={timelineBaseSegments()}>
													{(segment) => {
														const left = ((segment.start.getTime() - viewStart().getTime()) / totalMs) * 100;
														const width = ((segment.end.getTime() - segment.start.getTime()) / totalMs) * 100;
														const assignee = segment.assigneeId ? usersById().get(segment.assigneeId) : undefined;
														const colorClass = segment.assigneeId ? assigneeColorById().get(segment.assigneeId) : "bg-muted/50 text-muted-foreground border-border/50";

														return (
															<div
																class={cn("absolute z-0 h-10 rounded border px-2 flex items-center text-xs font-medium truncate pointer-events-none overflow-hidden", colorClass)}
																style={{ left: `${left}%`, width: `${Math.max(width, 1)}%`, top: `${baseTop}px` }}
																title={`${assignee?.name ?? "Unassigned"} • ${formatDateRange(segment.start, segment.end)}`}
															>
																<For each={segment.inactiveRanges}>
																	{(inactiveRange) => {
																		const relativeRange = getRelativeRangePercent(inactiveRange, segment);
																		return <div class="absolute inset-y-0" style={getShadedOverlayStyle(relativeRange)} />;
																	}}
																</For>
																<span class="relative z-10 truncate">{assignee?.name ?? "Unassigned"}</span>
															</div>
														);
													}}
												</For>

												<For each={overrideLayout().items}>
													{(override) => {
														const left = ((override.start.getTime() - viewStart().getTime()) / totalMs) * 100;
														const width = ((override.end.getTime() - override.start.getTime()) / totalMs) * 100;
														const assignee = usersById().get(override.assigneeId);
														const colorClass = override.assigneeId ? assigneeColorById().get(override.assigneeId) : "bg-muted text-muted-foreground border-border";
														const top = overrideTop + override.row * (rowHeight + rowGap);
														const isDeleting = clearOverrideMutation.isPending && clearOverrideMutation.variables?.overrideId === override.id;
														const isNarrow = width < 8;

														return (
															<div
																class={cn(
																	"group absolute z-10 h-10 rounded border-2 border-amber-400/80 flex items-center text-xs font-medium select-none pointer-events-auto overflow-hidden",
																	colorClass,
																	isNarrow ? "justify-center px-0.5" : "px-2 gap-2",
																)}
																style={{ left: `${left}%`, width: `${Math.max(width, 1)}%`, top: `${top}px` }}
																title={`${assignee?.name ?? "Unassigned"} • ${formatDateRange(override.start, override.end)} (override)`}
																data-override="true"
															>
																<For each={override.inactiveRanges}>
																	{(inactiveRange) => {
																		const relativeRange = getRelativeRangePercent(inactiveRange, override);
																		return <div class="absolute inset-y-0" style={getShadedOverlayStyle(relativeRange)} />;
																	}}
																</For>
																<span class={cn("relative z-10 truncate min-w-0", isNarrow && "hidden")}>{assignee?.name ?? "Unassigned"}</span>
																<div class={cn("relative z-10 flex items-center gap-0.5 transition-opacity", isNarrow ? "opacity-100" : "opacity-0 group-hover:opacity-100")}>
																	<Button
																		variant="ghost"
																		size="icon"
																		class="h-6 w-6 text-muted-foreground hover:text-foreground hover:bg-white/50"
																		aria-label="Edit override"
																		onPointerDown={(e) => e.stopPropagation()}
																		onClick={() => openEditOverride(override)}
																	>
																		<Pencil class="w-3 h-3" />
																	</Button>
																	<Button
																		variant="ghost"
																		size="icon"
																		class="h-6 w-6 text-destructive hover:text-destructive hover:bg-white/50"
																		aria-label="Delete override"
																		onPointerDown={(e) => e.stopPropagation()}
																		onClick={() => clearOverrideMutation.mutate({ rotationId: props.rotation.id, overrideId: override.id })}
																		disabled={isDeleting}
																	>
																		<Show when={isDeleting} fallback={<Trash2 class="w-3 h-3" />}>
																			<LoaderCircle class="w-3 h-3 animate-spin" />
																		</Show>
																	</Button>
																</div>
															</div>
														);
													}}
												</For>

												<Show when={isSelecting() && selectionRange()}>
													{(range) => (
														<div
															class="absolute z-30 h-10 rounded bg-primary/15 border-2 border-primary/50 border-dashed pointer-events-none"
															style={{
																left: `${((range().start.getTime() - viewStart().getTime()) / totalMs) * 100}%`,
																width: `${Math.max(((range().end.getTime() - range().start.getTime()) / totalMs) * 100, 1)}%`,
																top: `${overrideTop}px`,
															}}
														/>
													)}
												</Show>

												<Show when={popoverOpen() && parsedOverrideStart() && parsedOverrideEnd()}>
													<div
														class="absolute z-30 h-10 rounded bg-primary/15 border-2 border-primary/50 pointer-events-none"
														style={{
															left: `${((parsedOverrideStart()!.getTime() - viewStart().getTime()) / totalMs) * 100}%`,
															width: `${Math.max(((parsedOverrideEnd()!.getTime() - parsedOverrideStart()!.getTime()) / totalMs) * 100, 1)}%`,
															top: `${overrideTop}px`,
														}}
													/>
												</Show>
											</div>
										);
									})()}

									<Show when={popoverOpen() && popoverPosition()}>
										{(pos) => (
											<div
												class="absolute z-30 mt-2 w-80 rounded-lg border border-border bg-popover p-3 shadow-lg"
												style={{
													left: `max(0%, min(${pos().left}%, calc(100% - 20rem)))`,
													top: "100%",
												}}
											>
												<div class="flex items-center justify-between mb-3">
													<span class="text-sm font-medium">{overrideMode() === "edit" ? "Edit Override" : "Create Override"}</span>
													<Button variant="ghost" size="icon" class="h-6 w-6" onClick={closePopover}>
														<X class="w-3.5 h-3.5" />
													</Button>
												</div>
												<div class="space-y-3">
													<div class="grid gap-2 grid-cols-2">
														<div class="space-y-1">
															<Label for="override-start" class="text-xs">
																Start
															</Label>
															<Input
																id="override-start"
																type="datetime-local"
																value={overrideStartInput()}
																onInput={(e) => setOverrideStartInput(e.currentTarget.value)}
																disabled={isSavingOverride()}
																class="h-8 text-xs"
															/>
														</div>
														<div class="space-y-1">
															<Label for="override-end" class="text-xs">
																End
															</Label>
															<Input
																id="override-end"
																type="datetime-local"
																value={overrideEndInput()}
																onInput={(e) => setOverrideEndInput(e.currentTarget.value)}
																disabled={isSavingOverride()}
																class="h-8 text-xs"
															/>
														</div>
													</div>
													<EntityPicker
														entities={assigneeEntities}
														onSelect={(entity) => setSelectedAssignee(entity.id)}
														selectedId={selectedAssignee() ?? undefined}
														placeholder="Choose assignee..."
														emptyMessage="No assignees available."
														disabled={isSavingOverride()}
													/>
													<div class="flex justify-end gap-2 pt-1">
														<Button variant="ghost" size="sm" onClick={closePopover} class="h-7 text-xs">
															Cancel
														</Button>
														<Button size="sm" onClick={handleSaveOverride} disabled={!selectedAssignee() || !isOverrideRangeValid() || isSavingOverride()} class="h-7 text-xs">
															<Show when={isSavingOverride()} fallback={overrideMode() === "edit" ? "Save" : "Create"}>
																<LoaderCircle class="w-3.5 h-3.5 animate-spin" />
															</Show>
														</Button>
													</div>
												</div>
											</div>
										)}
									</Show>
								</>
							}
						>
							<div class="space-y-2">
								<div class="grid grid-cols-7 text-xs text-muted-foreground">
									<For each={WEEKDAY_LABELS}>{(label) => <div class="px-2 py-1.5">{label}</div>}</For>
								</div>
								<div class="grid grid-cols-7 gap-px rounded-lg border border-border/60 bg-border/60 overflow-hidden">
									<For each={calendarDays()}>
										{(day) => {
											const dayKey = startOfDay(day).toDateString();
											const assigneeId = calendarAssigneeByDay().get(dayKey);
											const assignee = assigneeId ? usersById().get(assigneeId) : undefined;
											const isCurrentMonth = day.getMonth() === calendarMonthStart().getMonth() && day.getFullYear() === calendarMonthStart().getFullYear();
											const isToday = isSameDay(day, new Date());
											const colorClass = assigneeId
												? (assigneeColorById().get(assigneeId) ?? "bg-muted/50 text-muted-foreground border-border/50")
												: "bg-muted/50 text-muted-foreground border-border/50";

											return (
												<div
													class={cn(
														"min-h-[96px] bg-background p-2 flex flex-col gap-1",
														!isCurrentMonth && "bg-muted/20 text-muted-foreground",
														isToday && "ring-1 ring-primary/40",
													)}
												>
													<div class="flex items-center justify-between">
														<span class={cn("text-xs font-medium", isToday && "text-primary")}>{day.getDate()}</span>
													</div>
													<Show when={assigneeId}>
														<div
															class={cn("inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium truncate", colorClass)}
															title={assignee?.name ?? "Unknown user"}
														>
															<span class="truncate">{assignee?.name ?? "Unknown user"}</span>
														</div>
													</Show>
												</div>
											);
										}}
									</For>
								</div>
							</div>
						</Show>
					</div>
				</Show>
			</div>
		</div>
	);
}

function AssigneesEmptyState() {
	return (
		<div class="flex flex-col items-center justify-center py-6 border border-dashed border-border rounded-lg bg-muted/20">
			<UsersIcon class="w-6 h-6 text-muted-foreground mb-2" />
			<p class="text-sm text-muted-foreground">No assignees in this rotation yet</p>
		</div>
	);
}

function RotationNotFound() {
	return <div class="border border-dashed border-border rounded-lg p-8 text-center text-sm text-muted-foreground">Rotation not found.</div>;
}

function RotationDetailsSkeleton() {
	return (
		<div class="space-y-6">
			<div class="space-y-2">
				<Skeleton class="h-8 w-48" />
				<Skeleton class="h-4 w-32" />
			</div>
			<div class="grid gap-6 lg:grid-cols-[320px_1fr]">
				<Skeleton class="h-96 w-full" />
				<Skeleton class="h-96 w-full" />
			</div>
		</div>
	);
}

function AssigneePickerContent(props: {
	onSelect: (entity: { id: string; name: string; avatar?: string | null; type: "user" | "slack" }) => void;
	isAdding: () => boolean;
	existingAssigneeIds: string[];
	teamId?: string | null;
}) {
	const users = usePossibleSlackUsers();

	const entities = createMemo(() => {
		const filteredUsers = props.teamId
			? users().filter((u) => {
					if (u.type === "user") {
						return u.teams.some((membership) => membership.id === props.teamId);
					} else {
						return false;
					}
				})
			: users();

		return filteredUsers.map((u) => ({
			id: u.id,
			name: u.name,
			avatar: u.avatar,
			type: u.type,
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

type TimeRange = { start: Date; end: Date };
type BaseSegment = TimeRange & { assigneeId?: string };
type RotationOverrideSegment = TimeRange & { id: string; assigneeId: string; createdAt: Date };

function parseShiftLengthMs(interval: string) {
	const match = interval.match(/(\d+)\s*(day|week)s?/);
	if (!match) return null;
	const value = Number.parseInt(match[1], 10);
	const unit = match[2];
	if (unit === "day") return value * DAY_MS;
	if (unit === "week") return value * 7 * DAY_MS;
	return null;
}

function buildBaseSegments(input: { assignees: Rotation["assignees"]; shiftStart: Date; shiftMs: number; viewStart: Date; viewEnd: Date }): BaseSegment[] {
	const { assignees, shiftStart, shiftMs, viewStart, viewEnd } = input;
	if (assignees.length === 0) return [];

	const segments: BaseSegment[] = [];
	const startOffset = Math.floor((viewStart.getTime() - shiftStart.getTime()) / shiftMs);
	let index = startOffset;

	while (true) {
		const segmentStart = new Date(shiftStart.getTime() + index * shiftMs);
		const segmentEnd = new Date(segmentStart.getTime() + shiftMs);

		if (segmentEnd <= viewStart) {
			index += 1;
			continue;
		}

		if (segmentStart >= viewEnd) break;

		const start = segmentStart < viewStart ? viewStart : segmentStart;
		const end = segmentEnd > viewEnd ? viewEnd : segmentEnd;
		const assigneeIndex = mod(index, assignees.length);
		const assigneeId = assignees[assigneeIndex]?.id;

		segments.push({ start, end, assigneeId });
		index += 1;
	}

	return segments;
}

function compareOverridePriority(a: RotationOverrideSegment, b: RotationOverrideSegment) {
	const createdAtDiff = a.createdAt.getTime() - b.createdAt.getTime();
	if (createdAtDiff !== 0) return createdAtDiff;
	return a.id.localeCompare(b.id);
}

function getEffectiveAssigneeIdAt(at: Date, baseSegments: BaseSegment[], overridesByPriority: RotationOverrideSegment[]) {
	const activeOverride = overridesByPriority.find((override) => override.start <= at && override.end > at);
	if (activeOverride) {
		return activeOverride.assigneeId;
	}
	return baseSegments.find((segment) => segment.start <= at && segment.end > at)?.assigneeId;
}

function getCalendarDayAssigneeId(dayStart: Date, baseSegments: BaseSegment[], overridesByPriority: RotationOverrideSegment[]) {
	const dayEnd = addDays(dayStart, 1);
	const midday = new Date(dayStart.getTime() + 12 * HOUR_MS);

	const overrideAtMidday = overridesByPriority.find((override) => override.start <= midday && override.end > midday);
	if (overrideAtMidday) {
		return overrideAtMidday.assigneeId;
	}

	const overlappingOverride = overridesByPriority.find((override) => override.start < dayEnd && override.end > dayStart);
	if (overlappingOverride) {
		return overlappingOverride.assigneeId;
	}

	return getEffectiveAssigneeIdAt(midday, baseSegments, overridesByPriority);
}

function collectOverlapRanges(target: TimeRange, ranges: TimeRange[]): TimeRange[] {
	const targetStart = target.start.getTime();
	const targetEnd = target.end.getTime();
	if (targetEnd <= targetStart) return [];

	const overlapRanges = ranges
		.map((range) => {
			const start = Math.max(targetStart, range.start.getTime());
			const end = Math.min(targetEnd, range.end.getTime());
			return end > start ? { start, end } : null;
		})
		.filter((range): range is { start: number; end: number } => range !== null)
		.sort((a, b) => a.start - b.start);

	if (overlapRanges.length === 0) return [];

	const mergedRanges: { start: number; end: number }[] = [overlapRanges[0]];
	for (const range of overlapRanges.slice(1)) {
		const current = mergedRanges[mergedRanges.length - 1];
		if (range.start <= current.end) {
			current.end = Math.max(current.end, range.end);
		} else {
			mergedRanges.push({ ...range });
		}
	}

	return mergedRanges.map((range) => ({
		start: new Date(range.start),
		end: new Date(range.end),
	}));
}

function getRelativeRangePercent(range: TimeRange, container: TimeRange) {
	const containerDuration = container.end.getTime() - container.start.getTime();
	if (containerDuration <= 0) {
		return { left: 0, width: 0 };
	}

	const left = ((range.start.getTime() - container.start.getTime()) / containerDuration) * 100;
	const width = ((range.end.getTime() - range.start.getTime()) / containerDuration) * 100;

	return {
		left: Math.max(0, Math.min(left, 100)),
		width: Math.max(0, Math.min(width, 100)),
	};
}

function getShadedOverlayStyle(range: { left: number; width: number }) {
	return {
		left: `${range.left}%`,
		width: `${Math.max(range.width, 0)}%`,
		"background-color": "rgba(148, 163, 184, 0.22)",
		"background-image": "repeating-linear-gradient(135deg, rgba(71, 85, 105, 0.35) 0px, rgba(71, 85, 105, 0.35) 2px, transparent 2px, transparent 10px)",
	};
}

function mod(value: number, base: number) {
	return ((value % base) + base) % base;
}

function formatDateRange(start: Date, end: Date) {
	const startText = start.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
	const endText = end.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
	return `${startText} to ${endText}`;
}

function startOfDay(date: Date) {
	const next = new Date(date);
	next.setHours(0, 0, 0, 0);
	return next;
}

function startOfMonth(date: Date) {
	const next = new Date(date);
	next.setDate(1);
	next.setHours(0, 0, 0, 0);
	return next;
}

function addDays(date: Date, days: number) {
	const next = new Date(date);
	next.setDate(next.getDate() + days);
	return next;
}

function addMonths(date: Date, months: number) {
	return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function startOfWeek(date: Date) {
	const next = startOfDay(date);
	const mondayOffset = (next.getDay() + 6) % 7;
	return addDays(next, -mondayOffset);
}

function endOfWeek(date: Date) {
	return addDays(startOfWeek(date), 6);
}

function isSameDay(a: Date, b: Date) {
	return startOfDay(a).getTime() === startOfDay(b).getTime();
}

function floorToHour(date: Date) {
	const next = new Date(date);
	next.setMinutes(0, 0, 0);
	return next;
}

function formatDateTimeLocal(date: Date) {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	const hours = String(date.getHours()).padStart(2, "0");
	const minutes = String(date.getMinutes()).padStart(2, "0");
	return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function parseDateTimeLocal(value: string) {
	if (!value) return null;
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeShiftLength(interval: string): string {
	const match = interval.match(/(\d+)\s*(day|days|week|weeks)/);
	if (!match) return SHIFT_LENGTH_OPTIONS[0].value;
	const num = Number.parseInt(match[1], 10);
	const unit = match[2];
	if (unit === "day" || unit === "days") {
		if (num === 1) return "1 day";
		if (num === 7) return "1 week";
		if (num === 14) return "2 weeks";
	}
	if (unit === "week" || unit === "weeks") {
		if (num === 1) return "1 week";
		if (num === 2) return "2 weeks";
	}
	return SHIFT_LENGTH_OPTIONS[0].value;
}
