import { createFileRoute, Link } from "@tanstack/solid-router";
import { Check, ChevronDown, Link2, LoaderCircle, RefreshCw, User, X } from "lucide-solid";
import { type Accessor, createMemo, createSignal, For, Show, Suspense } from "solid-js";
import { EntryPointCardSkeleton, EntryPointsList } from "~/components/entry-points/EntryPointCard";
import { SlackAvatar, SlackEntityPicker } from "~/components/SlackEntityPicker";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import {
	toCreateInput,
	toCreateRotationInput,
	useCreateEntryPoint,
	useDeleteEntryPoint,
	useEntryPoints,
	useSetFallbackEntryPoint,
	useUpdateEntryPointPrompt,
} from "~/lib/entry-points/entry-points.hooks";
import { useIntegrations } from "~/lib/integrations/integrations.hooks";
import { useRotations } from "~/lib/rotations/rotations.hooks";

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
	const entryPointsQuery = useEntryPoints();
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

	const rotationsQuery = useRotations();
	const rotations = () => rotationsQuery.data ?? [];

	let inFlightCreate: ReturnType<typeof createMutation.mutateAsync> | null = null;
	const createMutation = useCreateEntryPoint({
		onMutate: () => {
			// No-op here, handled by local state in List
		},
		onSuccess: (realId) => {
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
		return createMutation.mutateAsync(toCreateInput(user));
	};

	const handleSelectRotation = (rotation: { id: string; name: string }) => {
		return createMutation.mutateAsync(toCreateRotationInput(rotation));
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
			<EntryPointsList
				entryPoints={entryPoints()}
				rotations={rotations()}
				onDelete={handleDelete}
				onUpdatePrompt={handleUpdatePrompt}
				onSetFallback={handleSetFallback}
				isDeletingId={deleteMutation.variables ?? null}
				isSettingFallbackId={setFallbackMutation.variables ?? null}
				createButtonText="Create Entry Point"
				createButtonPosition="left"
				createContent={(props) => (
					<AddEntryPointPicker
						onCancel={props.onCancel}
						onSuccess={props.onSuccess}
						onSelectSlackUser={async (user) => {
							const { id } = await handleSelectSlackUser(user);
							props.onSuccess(id);
						}}
						onSelectRotation={async (rotation) => {
							const { id } = await handleSelectRotation(rotation);
							props.onSuccess(id);
						}}
						isAdding={() => createMutation.isPending}
					/>
				)}
			/>
			<EntryPointsFooter count={entryPoints().filter((ep) => !!ep.prompt || ep.isFallback).length} />
		</div>
	);
}

// --- Create Entry Point Picker ---

interface AddEntryPointPickerProps {
	onCancel: () => void;
	onSuccess: (id: string) => void;
	isAdding: Accessor<boolean>;
	onSelectSlackUser: (user: { id: string; name?: string; avatar?: string }) => Promise<void>;
	onSelectRotation: (rotation: { id: string; name: string }) => Promise<void>;
}

function AddEntryPointPicker(props: AddEntryPointPickerProps) {
	const [step, setStep] = createSignal<PickerStep>("type-selection");

	const handleBack = () => setStep("type-selection");

	const getTitle = createMemo(() => {
		switch (step()) {
			case "type-selection":
				return "Create entry point";
			case "slack-user":
				return "Select Slack user";
			case "rotation":
				return "Select rotation";
			default:
				return "";
		}
	});

	return (
		<div class="border border-border rounded-lg bg-muted/20 overflow-hidden">
			<div class="flex items-center justify-between px-4 py-3 border-b border-border">
				<div class="flex items-center gap-2">
					<Show when={step() !== "type-selection"}>
						<Button variant="ghost" size="icon" class="h-8 w-8 cursor-pointer" onClick={handleBack}>
							<ChevronDown class="w-4 h-4 rotate-90" />
						</Button>
					</Show>
					<h4 class="text-sm font-medium text-foreground">{getTitle()}</h4>
				</div>
				<Button variant="ghost" size="icon" class="h-8 w-8 cursor-pointer" onClick={props.onCancel}>
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
				<Show when={step() === "type-selection"}>
					<TypeSelectionContent setStep={setStep} />
				</Show>
				<Show when={step() === "slack-user"}>
					<SlackUserPickerContent onSelect={props.onSelectSlackUser} isAdding={props.isAdding} />
				</Show>
				<Show when={step() === "rotation"}>
					<RotationPickerContent onSelect={props.onSelectRotation} isAdding={props.isAdding} />
				</Show>
			</Suspense>
		</div>
	);
}

function TypeSelectionContent(props: { setStep: (step: PickerStep) => void }) {
	const integrationsQuery = useIntegrations();

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
					<Button
						variant="ghost"
						class="flex flex-col items-center gap-3 p-5 h-auto rounded-xl border-2 border-emerald-200 bg-emerald-50/50 hover:bg-emerald-100/50 hover:border-emerald-300 transition-all text-center group"
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
					</Button>

					<Button
						variant="ghost"
						class="flex flex-col items-center gap-3 p-5 h-auto rounded-xl border-2 border-border bg-muted/30 hover:bg-muted/50 hover:border-muted-foreground/30 transition-all text-center group"
						onClick={() => props.setStep("slack-user")}
					>
						<div class="flex items-center justify-center w-12 h-12 rounded-xl bg-blue-100 text-blue-600 group-hover:scale-105 transition-transform">
							<User class="w-6 h-6" />
						</div>
						<div class="space-y-1">
							<span class="font-semibold text-foreground">Slack User</span>
							<p class="text-xs text-muted-foreground">Specific person</p>
						</div>
					</Button>
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
	const rotationsQuery = useRotations();
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
								<SlackAvatar id={rotation.currentAssignee} />
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
