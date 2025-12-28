import { useQuery } from "@tanstack/solid-query";
import { createFileRoute, Link } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { Check, ChevronDown, ChevronUp, Link2, LoaderCircle, Plus, RefreshCw, Star, TriangleAlert, User, Users, X } from "lucide-solid";
import { type Accessor, createMemo, createSignal, For, Index, Show, Suspense } from "solid-js";
import { SlackEntityPicker, UserAvatar } from "~/components/SlackEntityPicker";
import { AutoSaveTextarea } from "~/components/ui/auto-save-textarea";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { ConfigCard, ConfigCardActions, ConfigCardDeleteButton, ConfigCardRow, ConfigCardTitle } from "~/components/ui/config-card";
import { Skeleton } from "~/components/ui/skeleton";
import { getEntryPoints } from "~/lib/entry-points";
import { toCreateInput, toCreateRotationInput, useCreateEntryPoint, useDeleteEntryPoint, useSetFallbackEntryPoint, useUpdateEntryPointPrompt } from "~/lib/entry-points.hooks";
import { getWorkspaceIntegrations } from "~/lib/integrations";
import { getRotations } from "~/lib/rotation";
import { useSlackUser } from "~/lib/useSlackUser";

export const Route = createFileRoute("/_authed/config/entry-points")({
	component: EntryPointsConfig,
});

function EntryPointsConfig() {
	return (
		<Card class="p-6">
			<Suspense fallback={<EntryPointsContentSkeleton />}>
				<EntryPointsContent />
			</Suspense>
		</Card>
	);
}

type PickerStep = "closed" | "type-selection" | "slack-user" | "rotation";

function EntryPointsContent() {
	const getEntryPointsFn = useServerFn(getEntryPoints);
	const entryPointsQuery = useQuery(() => ({
		queryKey: ["entry-points"],
		queryFn: getEntryPointsFn,
		staleTime: 60_000,
	}));
	const entryPoints = createMemo(
		() =>
			entryPointsQuery.data?.map((ep) => {
				const type = ep.type === "rotation" ? "rotation" : "user";
				return {
					id: ep.id,
					prompt: ep.prompt,
					isFallback: ep.isFallback,
					...(type === "rotation"
						? ({
								type,
								rotationId: ep.rotationId!,
							} as const)
						: ({ type, assigneeId: ep.assigneeId! } as const)),
				};
			}) ?? [],
	);

	const [pickerStep, setPickerStep] = createSignal<PickerStep>("closed");
	const [expandedId, setExpandedId] = createSignal<string | null>(null);

	let inFlightCreate: ReturnType<typeof createMutation.mutateAsync> | null = null;
	const createMutation = useCreateEntryPoint({
		onMutate: (tempId) => {
			setPickerStep("closed");
			setExpandedId(tempId);
		},
		onSuccess: (realId) => {
			setExpandedId(realId);
			return realId;
		},
		onSettled: () => {
			inFlightCreate = null;
		},
	});

	const deleteMutation = useDeleteEntryPoint();
	const updateMutation = useUpdateEntryPointPrompt();
	const setFallbackMutation = useSetFallbackEntryPoint();

	const handleSelectSlackUser = (user: { id: string; name?: string; avatar?: string }) => {
		inFlightCreate = createMutation.mutateAsync(toCreateInput(user));
	};

	const handleSelectRotation = (rotation: { id: string; name: string }) => {
		inFlightCreate = createMutation.mutateAsync(toCreateRotationInput(rotation));
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

	const handleUpdatePrompt = async (id: string, prompt: string) => {
		if (inFlightCreate) {
			const { id: newId } = await inFlightCreate;
			id = newId;
		}
		await updateMutation.mutateAsync({ id, prompt });
	};

	const handleSetFallback = (id: string) => {
		setFallbackMutation.mutate(id);
	};

	return (
		<div class="space-y-6">
			<AddEntryPointPicker
				step={pickerStep}
				setStep={setPickerStep}
				isAdding={() => createMutation.isPending}
				onSelectSlackUser={handleSelectSlackUser}
				onSelectRotation={handleSelectRotation}
			/>

			<Show when={pickerStep() === "closed"}>
				<Show when={entryPoints().length > 0} fallback={<EntryPointsEmptyState />}>
					<div class="space-y-3">
						<Index each={entryPoints()}>
							{(entryPoint, index) => (
								<Suspense fallback={<EntryPointCardSkeleton />}>
									<EntryPointCard
										entryPoint={entryPoint()}
										index={index}
										onDelete={handleDelete}
										onUpdatePrompt={(prompt) => handleUpdatePrompt(entryPoint().id, prompt)}
										onSetFallback={handleSetFallback}
										isDeleting={deleteMutation.isPending && deleteMutation.variables === entryPoint().id}
										isSettingFallback={setFallbackMutation.isPending}
										isExpanded={expandedId() === entryPoint().id}
										onToggle={() => toggleExpanded(entryPoint().id)}
									/>
								</Suspense>
							)}
						</Index>
					</div>
				</Show>
			</Show>
			<EntryPointsFooter count={entryPoints().filter((ep) => !!ep.prompt || ep.isFallback).length} />
		</div>
	);
}

// --- Add Entry Point Picker ---

interface AddEntryPointPickerProps {
	step: Accessor<PickerStep>;
	setStep: (step: PickerStep) => void;
	isAdding: Accessor<boolean>;
	onSelectSlackUser: (user: { id: string; name?: string; avatar?: string }) => void;
	onSelectRotation: (rotation: { id: string; name: string }) => void;
}

function AddEntryPointPicker(props: AddEntryPointPickerProps) {
	const handleCancel = () => props.setStep("closed");
	const handleBack = () => props.setStep("type-selection");

	const getTitle = createMemo(() => {
		switch (props.step()) {
			case "type-selection":
				return "Add entry point";
			case "slack-user":
				return "Select Slack user";
			case "rotation":
				return "Select rotation";
			default:
				return "";
		}
	});

	return (
		<Show
			when={props.step() !== "closed"}
			fallback={
				<Button onClick={() => props.setStep("type-selection")} disabled={props.isAdding()}>
					<Plus class="w-4 h-4" />
					Add Entry Point
				</Button>
			}
		>
			<div class="border border-border rounded-lg bg-muted/20 overflow-hidden">
				<div class="flex items-center justify-between px-4 py-3 border-b border-border">
					<div class="flex items-center gap-2">
						<Show when={props.step() !== "type-selection"}>
							<Button variant="ghost" size="icon" class="h-8 w-8 cursor-pointer" onClick={handleBack}>
								<ChevronDown class="w-4 h-4 rotate-90" />
							</Button>
						</Show>
						<h4 class="text-sm font-medium text-foreground">{getTitle()}</h4>
					</div>
					<Button variant="ghost" size="icon" class="h-8 w-8 cursor-pointer" onClick={handleCancel}>
						<X class="w-4 h-4" />
					</Button>
				</div>
				<Suspense
					fallback={
						<div class="flex items-center justify-center py-8 px-6 text-center">
							<LoaderCircle class="w-4 h-4 animate-spin" />
						</div>
					}
				>
					<Show when={props.step() === "type-selection"}>
						<TypeSelectionContent setStep={props.setStep} />
					</Show>
					<Show when={props.step() === "slack-user"}>
						<SlackUserPickerContent onSelect={props.onSelectSlackUser} isAdding={props.isAdding} />
					</Show>
					<Show when={props.step() === "rotation"}>
						<RotationPickerContent onSelect={props.onSelectRotation} isAdding={props.isAdding} />
					</Show>
				</Suspense>
			</div>
		</Show>
	);
}

function TypeSelectionContent(props: { setStep: (step: PickerStep) => void }) {
	const getWorkspaceIntegrationsFn = useServerFn(getWorkspaceIntegrations);
	const integrationsQuery = useQuery(() => ({
		queryKey: ["integrations"],
		queryFn: getWorkspaceIntegrationsFn,
		staleTime: 60_000,
	}));

	const hasSlackIntegration = () => integrationsQuery.data?.some((i) => i.platform === "slack" && i.installedAt);

	return (
		<Show
			when={hasSlackIntegration()}
			fallback={
				<Show when={!integrationsQuery.data?.length}>
					<div class="flex flex-col items-center justify-center py-8 px-6 text-center">
						<div class="relative mb-4">
							<div class="absolute inset-0 bg-amber-400/20 rounded-full blur-xl animate-pulse" />
							<div class="relative p-3 rounded-full bg-gradient-to-br from-amber-100 to-amber-50 border border-amber-200/60">
								<Link2 class="w-6 h-6 text-amber-600" />
							</div>
						</div>
						<h4 class="text-sm font-medium text-foreground mb-1">No connected integrations</h4>
						<p class="text-sm text-muted-foreground max-w-xs mb-4">Connect an integration to start adding entry points for incident routing.</p>
						<Button as={Link} to="/config/integrations" variant="outline" size="sm" class="cursor-pointer">
							Connect Integration
						</Button>
					</div>
				</Show>
			}
		>
			<div class="p-4">
				<div class="grid grid-cols-2 gap-3">
					<button
						type="button"
						class="flex flex-col items-center gap-3 p-5 rounded-xl border-2 border-emerald-200 bg-emerald-50/50 hover:bg-emerald-100/50 hover:border-emerald-300 transition-all cursor-pointer text-center group"
						onClick={() => props.setStep("rotation")}
					>
						<div class="flex items-center justify-center w-12 h-12 rounded-xl bg-emerald-100 text-emerald-600 group-hover:scale-105 transition-transform">
							<RefreshCw class="w-6 h-6" />
						</div>
						<div class="space-y-1">
							<div class="flex items-center justify-center gap-1.5">
								<span class="font-semibold text-foreground">Rotation</span>
								<Badge variant="secondary" class="text-[9px] px-1.5 py-0 bg-emerald-100 text-emerald-700 border-emerald-200">
									Recommended
								</Badge>
							</div>
							<p class="text-xs text-muted-foreground">On-call schedule</p>
						</div>
					</button>

					<button
						type="button"
						class="flex flex-col items-center gap-3 p-5 rounded-xl border-2 border-border bg-muted/30 hover:bg-muted/50 hover:border-muted-foreground/30 transition-all cursor-pointer text-center group"
						onClick={() => props.setStep("slack-user")}
					>
						<div class="flex items-center justify-center w-12 h-12 rounded-xl bg-blue-100 text-blue-600 group-hover:scale-105 transition-transform">
							<User class="w-6 h-6" />
						</div>
						<div class="space-y-1">
							<span class="font-semibold text-foreground">Slack User</span>
							<p class="text-xs text-muted-foreground">Specific person</p>
						</div>
					</button>
				</div>
			</div>
		</Show>
	);
}

function SlackUserPickerContent(props: { onSelect: (user: { id: string; name?: string; avatar?: string }) => void; isAdding: Accessor<boolean> }) {
	return (
		<SlackEntityPicker
			onSelect={(entity) => {
				if (entity.type === "user") {
					props.onSelect(entity);
				}
			}}
			disabled={props.isAdding()}
			placeholder="Search users..."
			emptyMessage="No users available."
			mode="users"
		/>
	);
}

function RotationPickerContent(props: { onSelect: (rotation: { id: string; name: string }) => void; isAdding: Accessor<boolean> }) {
	const getRotationsFn = useServerFn(getRotations);
	const rotationsQuery = useQuery(() => ({
		queryKey: ["rotations"],
		queryFn: getRotationsFn,
		staleTime: 60_000,
	}));
	const rotations = () => rotationsQuery.data ?? [];

	return (
		<div class="p-2">
			<Show
				when={rotations().length > 0}
				fallback={
					<div class="flex flex-col items-center justify-center py-8 px-6 text-center">
						<div class="relative mb-4">
							<div class="absolute inset-0 bg-amber-400/20 rounded-full blur-xl animate-pulse" />
							<div class="relative p-3 rounded-full bg-gradient-to-br from-amber-100 to-amber-50 border border-amber-200/60">
								<RefreshCw class="w-6 h-6 text-amber-600" />
							</div>
						</div>
						<h4 class="text-sm font-medium text-foreground mb-1">No rotations available</h4>
						<p class="text-sm text-muted-foreground max-w-xs mb-4">Create a rotation with at least one assignee to use it as an entry point.</p>
						<Button as={Link} to="/config/rotation" variant="outline" size="sm" class="cursor-pointer">
							Configure Rotations
						</Button>
					</div>
				}
			>
				<div class="space-y-1">
					<For each={rotations()}>
						{(rotation) => (
							<button
								type="button"
								class="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer text-left disabled:opacity-50 disabled:cursor-not-allowed"
								onClick={() => props.onSelect(rotation)}
								disabled={props.isAdding()}
							>
								<UserAvatar id={rotation.currentAssignee} />
								<span class="flex-1 text-sm font-medium">{rotation.name}</span>
								<Check class="w-4 h-4 text-transparent" />
							</button>
						)}
					</For>
				</div>
			</Show>
		</div>
	);
}

// --- Skeleton ---

function EntryPointsContentSkeleton() {
	return (
		<div class="space-y-6">
			<Skeleton class="h-10 w-36" />
			<div class="space-y-3">
				<EntryPointCardSkeleton />
				<EntryPointCardSkeleton />
				<EntryPointCardSkeleton />
			</div>
			<Skeleton variant="text" class="h-4 w-24" />
		</div>
	);
}

function EntryPointCardSkeleton() {
	return (
		<div class="border border-border rounded-lg bg-muted/30 p-5">
			<div class="flex items-center gap-3">
				<Skeleton variant="circular" class="w-8 h-8" />
				<div class="flex-1 flex items-center gap-2">
					<Skeleton variant="text" class="h-4 w-24" />
					<Skeleton variant="text" class="h-4 w-48" />
				</div>
			</div>
		</div>
	);
}

// --- Empty State ---

function EntryPointsEmptyState() {
	return (
		<div class="flex flex-col items-center justify-center py-12 border border-dashed border-border rounded-lg">
			<div class="relative mb-4">
				<div class="absolute inset-0 bg-blue-400/20 rounded-full blur-xl animate-pulse" />
				<div class="relative p-3 rounded-full bg-gradient-to-br from-blue-100 to-blue-50 border border-blue-200/60">
					<Users class="w-8 h-8 text-blue-600" />
				</div>
			</div>
			<h3 class="text-lg font-medium text-foreground mb-1">No entry points yet</h3>
			<p class="text-sm text-muted-foreground text-center max-w-sm">Add rotations or Slack users to define entry points for incident routing.</p>
		</div>
	);
}

// --- Footer ---

interface EntryPointsFooterProps {
	count: number;
}

function EntryPointsFooter(props: EntryPointsFooterProps) {
	return (
		<Show when={props.count > 0}>
			<div class="pt-4 border-t border-border">
				<p class="text-sm text-muted-foreground">
					<span class="font-medium text-foreground">{props.count}</span> entry point
					{props.count !== 1 && "s"} configured
				</p>
			</div>
		</Show>
	);
}

// --- Entry Point Card ---
interface EntryPointCardProps {
	entryPoint: {
		id: string;
		prompt: string;
		isFallback: boolean;
	} & (
		| {
				type: "user";
				assigneeId: string;
		  }
		| {
				type: "rotation";
				rotationId: string;
		  }
	);
	index: number;
	onDelete: (id: string) => void;
	onUpdatePrompt: (prompt: string) => Promise<void>;
	onSetFallback: (id: string) => void;
	isDeleting: boolean;
	isSettingFallback: boolean;
	isExpanded: boolean;
	onToggle: () => void;
}

function EntryPointCard(props: EntryPointCardProps) {
	const handleSave = async (value: string) => {
		await props.onUpdatePrompt(value);
	};

	const getRotationsFn = useServerFn(getRotations);
	const rotationsQuery = useQuery(() => ({
		queryKey: ["rotations"],
		queryFn: getRotationsFn,
		staleTime: 60_000,
	}));

	const assignee = createMemo(() => {
		if (props.entryPoint.type === "user") {
			return props.entryPoint.assigneeId;
		} else if (props.entryPoint.type === "rotation") {
			const rotationId = props.entryPoint.rotationId;
			return rotationsQuery.data?.find((r) => r.id === rotationId)?.currentAssignee ?? "N/A";
		} else {
			return "N/A";
		}
	});

	const getFirstLine = (text: string) => {
		if (!text) return "";
		const firstLine = text.split("\n")[0];
		return firstLine.length > 80 ? `${firstLine.slice(0, 80)}...` : firstLine;
	};

	const hasMissingPrompt = () => !props.entryPoint.prompt.trim();
	const incomplete = () => hasMissingPrompt() && !props.isExpanded && !props.entryPoint.isFallback;

	const user = useSlackUser(assignee);

	const name = createMemo(() => {
		if (props.entryPoint.type === "rotation") {
			const rotationId = props.entryPoint.rotationId;
			return rotationsQuery.data?.find((r) => r.id === rotationId)?.name ?? "N/A";
		}
		return user()?.name ?? props.entryPoint.assigneeId;
	});

	return (
		<ConfigCard hasWarning={incomplete()} isActive={props.isExpanded}>
			<ConfigCardRow onClick={props.onToggle}>
				<UserAvatar id={assignee()} />

				<span class="flex-1 min-w-0">
					<span class="flex items-center gap-2">
						<ConfigCardTitle class="shrink-0">{name()}</ConfigCardTitle>

						<Show
							when={!incomplete()}
							fallback={
								<span class="text-sm text-amber-600 flex items-center gap-1.5 min-w-0">
									<TriangleAlert class="w-3.5 h-3.5 shrink-0" />
									<span class="truncate">Missing prompt — will never be matched</span>
								</span>
							}
						>
							<Show when={!hasMissingPrompt()}>
								<span class="text-sm text-muted-foreground truncate min-w-0">— {getFirstLine(props.entryPoint.prompt)}</span>
							</Show>
						</Show>
					</span>
				</span>

				<span class="flex items-center gap-2 shrink-0">
					<Show when={props.entryPoint.isFallback}>
						<span class="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200 text-[10px] font-bold uppercase tracking-wider shrink-0">
							<Star class="w-2.5 h-2.5 fill-current" />
							Fallback
						</span>
					</Show>

					<ConfigCardActions animated alwaysVisible={props.isExpanded}>
						<Show when={!props.entryPoint.isFallback}>
							<Button
								variant="ghost"
								size="sm"
								class="h-8 px-2 text-muted-foreground hover:text-blue-600 hover:bg-blue-50 cursor-pointer text-[10px] font-medium whitespace-nowrap"
								onClick={(e) => {
									e.stopPropagation();
									props.onSetFallback(props.entryPoint.id);
								}}
								disabled={props.isSettingFallback}
							>
								<Show when={props.isSettingFallback} fallback={<Star class="w-3 h-3 mr-1" />}>
									<LoaderCircle class="w-3 h-3 animate-spin mr-1" />
								</Show>
							</Button>
						</Show>

						<ConfigCardDeleteButton onDelete={() => props.onDelete(props.entryPoint.id)} isDeleting={props.isDeleting} alwaysVisible />
					</ConfigCardActions>

					<Show when={props.isExpanded} fallback={<ChevronDown class="w-4 h-4 text-muted-foreground" />}>
						<ChevronUp class="w-4 h-4 text-muted-foreground" />
					</Show>
				</span>
			</ConfigCardRow>

			<Show when={props.isExpanded}>
				<div class="px-4 pb-4">
					<AutoSaveTextarea
						id={`prompt-${props.entryPoint.id}`}
						label="Matching Prompt"
						placeholder={
							props.entryPoint.isFallback ? "Optional for fallback. Describe when to pick this if other prompts match partially..." : "Match this entry point when the incident..."
						}
						value={props.entryPoint.prompt}
						onSave={handleSave}
						rows={3}
						autoFocus
					/>
				</div>
			</Show>
		</ConfigCard>
	);
}
