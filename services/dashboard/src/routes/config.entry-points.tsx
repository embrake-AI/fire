import { useQuery } from "@tanstack/solid-query";
import { createFileRoute } from "@tanstack/solid-router";
import { LoaderCircle, Pencil, Plus, Trash2, TriangleAlert, Users, UsersRound, X } from "lucide-solid";
import { type Accessor, createEffect, createSignal, Index, Show } from "solid-js";
import { type SlackEntity, SlackEntityPicker } from "~/components/SlackEntityPicker";
import { AutoSaveTextarea } from "~/components/ui/auto-save-textarea";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { type EntryPoint, getEntryPoints } from "~/lib/entry-points";
import { toCreateGroupInput, toCreateInput, useCreateEntryPoint, useDeleteEntryPoint, useUpdateEntryPointPrompt } from "~/lib/entry-points.hooks";
import { cn } from "~/lib/utils";

export const Route = createFileRoute("/config/entry-points")({
	component: EntryPointsConfig,
	loader: ({ context }) =>
		context.queryClient.ensureQueryData({
			queryKey: ["entry-points"],
			queryFn: getEntryPoints,
		}),
});

function EntryPointsConfig() {
	const entryPointsQuery = useQuery(() => ({
		queryKey: ["entry-points"],
		queryFn: getEntryPoints,
		refetchInterval: 60_000,
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

	return (
		<Card class="p-6">
			<div class="space-y-6">
				<AddEntryPointPicker isOpen={isPickerOpen} setIsOpen={setIsPickerOpen} isAdding={() => createMutation.isPending} onSelect={handleSelectEntity} />

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
									isDeleting={deleteMutation.isPending && deleteMutation.variables === entryPoint().id}
									isNewlyCreated={newlyCreatedId() === entryPoint().id}
									onEditComplete={() => {
										setNewlyCreatedId(null);
									}}
								/>
							)}
						</Index>
					</div>
				</Show>

				<EntryPointsFooter count={entryPoints().filter((ep) => !!ep.prompt).length} />
			</div>
		</Card>
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
				<SlackEntityPicker onSelect={props.onSelect} disabled={props.isAdding()} placeholder="Search users or groups..." emptyMessage="All users and groups have been added." />
			</div>
		</Show>
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

interface EntryPointCardProps {
	entryPoint: EntryPoint;
	name: string;
	index: number;
	onDelete: (id: string) => void;
	onUpdatePrompt: (id: string, prompt: string) => Promise<void>;
	isDeleting: boolean;
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

	return (
		<div
			class={cn(
				"group border rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors",
				hasMissingPrompt() && !isEditing() ? "border-amber-300 bg-amber-50/50" : "border-border",
			)}
		>
			<div class="flex items-center gap-3 p-4">
				<div
					class={cn(
						"flex items-center justify-center w-8 h-8 rounded-full font-medium text-sm shrink-0",
						hasMissingPrompt() && !isEditing() ? "bg-amber-100 text-amber-600" : isGroup() ? "bg-emerald-100 text-emerald-600" : "bg-blue-100 text-blue-600",
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
						<span class="text-sm font-medium">{props.name}</span>
						<Show when={!isEditing()}>
							<Show
								when={props.entryPoint.prompt.trim()}
								fallback={
									<span class="text-sm text-amber-600 flex items-center gap-1.5">
										<TriangleAlert class="w-3.5 h-3.5" />
										Missing prompt — will never be matched
									</span>
								}
							>
								<span class="text-sm text-muted-foreground truncate">— {getFirstLine(props.entryPoint.prompt)}</span>
							</Show>
						</Show>

						<Show when={!isEditing()}>
							<Button variant="ghost" size="icon" onClick={handleEditClick} class="opacity-0 group-hover:opacity-100 transition-opacity h-6 w-6 text-muted-foreground">
								<Pencil class="w-3.5 h-3.5" />
							</Button>
						</Show>
					</div>
				</div>
				<Button
					variant="ghost"
					size="icon"
					class="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer"
					onClick={() => props.onDelete(props.entryPoint.id)}
					disabled={props.isDeleting}
				>
					<Show when={props.isDeleting} fallback={<Trash2 class="w-4 h-4" />}>
						<LoaderCircle class="w-4 h-4 animate-spin" />
					</Show>
				</Button>
			</div>

			<Show when={isEditing()}>
				<div class="px-4 pb-4">
					<AutoSaveTextarea
						id={`prompt-${props.entryPoint.id}`}
						label="Matching Prompt"
						placeholder="Match this entry point when the incident..."
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
