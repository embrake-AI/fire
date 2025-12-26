import { useQuery } from "@tanstack/solid-query";
import { createFileRoute, Link } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { Link2, LoaderCircle, Pencil, Plus, Star, Trash2, TriangleAlert, Users, UsersRound, X } from "lucide-solid";
import { type Accessor, createEffect, createSignal, Index, Show, Suspense } from "solid-js";
import { type SlackEntity, SlackEntityPicker } from "~/components/SlackEntityPicker";
import { AutoSaveTextarea } from "~/components/ui/auto-save-textarea";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { getEntryPoints } from "~/lib/entry-points";
import { toCreateGroupInput, toCreateInput, useCreateEntryPoint, useDeleteEntryPoint, useSetFallbackEntryPoint, useUpdateEntryPointPrompt } from "~/lib/entry-points.hooks";
import { getIntegrations } from "~/lib/integrations";
import { cn } from "~/lib/utils/client";

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

function EntryPointsContent() {
	const getEntryPointsFn = useServerFn(getEntryPoints);
	const entryPointsQuery = useQuery(() => ({
		queryKey: ["entry-points"],
		queryFn: getEntryPointsFn,
		staleTime: 60_000,
	}));
	const entryPoints = () => entryPointsQuery.data ?? [];

	const [isPickerOpen, setIsPickerOpen] = createSignal(false);
	const [newlyCreatedId, setNewlyCreatedId] = createSignal<string | null>(null);

	let inFlightCreate: ReturnType<typeof createMutation.mutateAsync> | null = null;
	const createMutation = useCreateEntryPoint({
		onMutate: (tempId) => {
			setIsPickerOpen(false);
			setNewlyCreatedId(tempId);
		},
		onSuccess: (realId) => realId,
		onSettled: () => {
			inFlightCreate = null;
		},
	});

	const deleteMutation = useDeleteEntryPoint();
	const updateMutation = useUpdateEntryPointPrompt();
	const setFallbackMutation = useSetFallbackEntryPoint();

	const handleSelectEntity = (entity: SlackEntity) => {
		if (entity.type === "user") {
			inFlightCreate = createMutation.mutateAsync(toCreateInput(entity.data));
		} else {
			inFlightCreate = createMutation.mutateAsync(toCreateGroupInput(entity.data));
		}
	};

	const handleDelete = (id: string) => {
		deleteMutation.mutate(id);
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
			<AddEntryPointPicker isOpen={isPickerOpen} setIsOpen={setIsPickerOpen} isAdding={() => createMutation.isPending} onSelect={handleSelectEntity} />

			<Show when={!isPickerOpen()}>
				<Show when={entryPoints().length > 0} fallback={<EntryPointsEmptyState />}>
					<div class="space-y-3">
						<Index each={entryPoints()}>
							{(entryPoint, index) => (
								<EntryPointCard
									entryPoint={entryPoint()}
									name={entryPoint().name}
									index={index}
									onDelete={handleDelete}
									onUpdatePrompt={handleUpdatePrompt}
									onSetFallback={handleSetFallback}
									isDeleting={deleteMutation.isPending && deleteMutation.variables === entryPoint().id}
									isSettingFallback={setFallbackMutation.isPending}
									isNewlyCreated={newlyCreatedId() === entryPoint().id}
									onEditComplete={() => {
										setNewlyCreatedId(null);
									}}
								/>
							)}
						</Index>
					</div>
				</Show>
			</Show>

			<EntryPointsFooter count={entryPoints().filter((ep) => !!ep.prompt && !ep.isFallback).length} />
		</div>
	);
}

// --- Add Entry Point Picker ---

interface AddEntryPointPickerProps {
	isOpen: Accessor<boolean>;
	setIsOpen: (open: boolean) => void;
	onSelect: (entity: SlackEntity) => void;
	isAdding: Accessor<boolean>;
}

function AddEntryPointPicker(props: AddEntryPointPickerProps) {
	const handleCancel = () => props.setIsOpen(false);

	return (
		<Show
			when={props.isOpen()}
			fallback={
				<Button onClick={() => props.setIsOpen(true)} disabled={props.isAdding()}>
					<Plus class="w-4 h-4" />
					Add Entry Point
				</Button>
			}
		>
			<div class="border border-border rounded-lg bg-muted/20 overflow-hidden">
				<div class="flex items-center justify-between px-4 py-3 border-b border-border">
					<h4 class="text-sm font-medium text-foreground">Add entry point</h4>
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
					<AddEntryPointPickerContent onSelect={props.onSelect} isAdding={props.isAdding} />
				</Suspense>
			</div>
		</Show>
	);
}

function AddEntryPointPickerContent(props: { onSelect: (entity: SlackEntity) => void; isAdding: Accessor<boolean> }) {
	const getIntegrationFn = useServerFn(getIntegrations);
	const integrationsQuery = useQuery(() => ({
		queryKey: ["integrations"],
		queryFn: getIntegrationFn,
		staleTime: 60_000,
	}));

	return (
		<Show
			when={integrationsQuery.data?.some((i) => i.platform === "slack" && i.installedAt)}
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
			<SlackEntityPicker onSelect={props.onSelect} disabled={props.isAdding()} placeholder="Search users or groups..." emptyMessage="All users and groups have been added." />
		</Show>
	);
}

// --- Skeleton ---

function EntryPointsContentSkeleton() {
	return (
		<div class="space-y-6 animate-in fade-in duration-200">
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
			<p class="text-sm text-muted-foreground text-center max-w-sm">Add Slack users or user groups to define entry points for incident routing.</p>
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
type GetEntryPointsResponse = Awaited<ReturnType<typeof getEntryPoints>>;
interface EntryPointCardProps {
	entryPoint: GetEntryPointsResponse[number];
	name: string;
	index: number;
	onDelete: (id: string) => void;
	onUpdatePrompt: (id: string, prompt: string) => Promise<void>;
	onSetFallback: (id: string) => void;
	isDeleting: boolean;
	isSettingFallback: boolean;
	isNewlyCreated: boolean;
	onEditComplete: () => void;
}

function EntryPointCard(props: EntryPointCardProps) {
	const [isEditing, setIsEditing] = createSignal(false);

	createEffect(() => {
		if (props.isNewlyCreated) {
			setIsEditing(true);
		}
	});

	const handleEditClick = () => {
		setIsEditing(true);
	};

	const handleEditComplete = () => {
		setIsEditing(false);
		props.onEditComplete();
	};

	const handleSave = async (value: string) => {
		await props.onUpdatePrompt(props.entryPoint.id, value);
	};

	const getFirstLine = (text: string) => {
		if (!text) return "";
		const firstLine = text.split("\n")[0];
		return firstLine.length > 80 ? `${firstLine.slice(0, 80)}...` : firstLine;
	};

	const hasMissingPrompt = () => !props.entryPoint.prompt.trim();
	const isGroup = () => props.entryPoint.type === "slack-user-group";

	const incomplete = () => hasMissingPrompt() && !isEditing() && !props.entryPoint.isFallback;

	return (
		<div class={cn("group border rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors", incomplete() ? "border-amber-300 bg-amber-50/50" : "border-border")}>
			<div class="flex items-center gap-3 p-4 overflow-hidden">
				<div
					class={cn(
						"flex items-center justify-center w-8 h-8 rounded-full font-medium text-sm shrink-0",
						incomplete() ? "bg-amber-100 text-amber-600" : isGroup() ? "bg-emerald-100 text-emerald-600" : "bg-blue-100 text-blue-600",
					)}
				>
					<Show
						when={isGroup()}
						fallback={
							<span>
								{props.name
									.split(" ")
									.map((n: string) => n[0])
									.join("")}
							</span>
						}
					>
						<UsersRound class="w-4 h-4" />
					</Show>
				</div>
				<div class="flex-1 min-w-0">
					<div class="flex items-center gap-2">
						<span class="text-sm font-medium shrink-0">{props.name}</span>

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

						<Show when={!isEditing()}>
							<Button variant="ghost" size="icon" onClick={handleEditClick} class="opacity-0 group-hover:opacity-100 transition-opacity h-6 w-6 text-muted-foreground shrink-0">
								<Pencil class="w-3.5 h-3.5" />
							</Button>
						</Show>
					</div>
				</div>

				<div class="flex items-center shrink-0">
					<Show when={props.entryPoint.isFallback}>
						<div class="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200 text-[10px] font-bold uppercase tracking-wider shrink-0">
							<Star class="w-2.5 h-2.5 fill-current" />
							Fallback
						</div>
					</Show>

					<div
						class={cn(
							"flex items-center gap-1 transition-all duration-300 ease-in-out overflow-hidden",
							isEditing() ? "max-w-[160px] opacity-100 ml-2" : "max-w-0 group-hover:max-w-[160px] opacity-0 group-hover:opacity-100 ml-0 group-hover:ml-2 group-hover:delay-200",
						)}
					>
						<Show when={!props.entryPoint.isFallback}>
							<Button
								variant="ghost"
								size="sm"
								class="h-8 px-2 text-muted-foreground hover:text-blue-600 hover:bg-blue-50 cursor-pointer text-[10px] font-medium whitespace-nowrap"
								onClick={() => props.onSetFallback(props.entryPoint.id)}
								disabled={props.isSettingFallback}
							>
								<Show when={props.isSettingFallback} fallback={<Star class="w-3 h-3 mr-1" />}>
									<LoaderCircle class="w-3 h-3 animate-spin mr-1" />
								</Show>
								{/* Set as fallback */}
							</Button>
						</Show>

						<Button
							variant="ghost"
							size="icon"
							class="text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer h-8 w-8 shrink-0"
							onClick={() => props.onDelete(props.entryPoint.id)}
							disabled={props.isDeleting}
						>
							<Show when={props.isDeleting} fallback={<Trash2 class="w-4 h-4" />}>
								<LoaderCircle class="w-4 h-4 animate-spin" />
							</Show>
						</Button>
					</div>
				</div>
			</div>

			<Show when={isEditing()}>
				<div class="px-4 pb-4">
					<AutoSaveTextarea
						id={`prompt-${props.entryPoint.id}`}
						label="Matching Prompt"
						placeholder={
							props.entryPoint.isFallback ? "Optional for fallback. Describe when to pick this if other prompts match partially..." : "Match this entry point when the incident..."
						}
						value={props.entryPoint.prompt}
						onSave={handleSave}
						onBlur={handleEditComplete}
						rows={3}
						autoFocus
					/>
				</div>
			</Show>
		</div>
	);
}
