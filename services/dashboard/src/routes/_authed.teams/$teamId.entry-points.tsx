import { createFileRoute, Link } from "@tanstack/solid-router";
import { LoaderCircle, Plus, Repeat, X } from "lucide-solid";
import { createMemo, createSignal, For, Index, Show, Suspense } from "solid-js";
import { EntryPointCard, EntryPointsEmptyState } from "~/components/entry-points/EntryPointCard";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Skeleton } from "~/components/ui/skeleton";
import { useCreateEntryPoint, useDeleteEntryPoint, useEntryPoints } from "~/lib/entry-points/entry-points.hooks";
import { useRotations } from "~/lib/rotations/rotations.hooks";

export const Route = createFileRoute("/_authed/teams/$teamId/entry-points")({
	component: TeamEntryPointsPage,
});

function TeamEntryPointsPage() {
	const params = Route.useParams();

	return (
		<Suspense fallback={<ListSkeleton rows={1} />}>
			<Show when={params().teamId}>{(id) => <TeamEntryPoints teamId={id()} />}</Show>
		</Suspense>
	);
}

function TeamEntryPoints(props: { teamId: string }) {
	const entryPointsQuery = useEntryPoints();
	const rotationsQuery = useRotations();

	// For an entrypoint to have a teamId it means that it has a rotation with that teamId
	const entryPoints = createMemo(
		() =>
			entryPointsQuery.data
				?.filter((ep) => ep.teamId === props.teamId && ep.type === "rotation")
				.map((ep) => {
					return {
						id: ep.id,
						prompt: ep.prompt,
						isFallback: ep.isFallback,
						type: "rotation" as const,
						rotationId: ep.rotationId!,
						teamId: ep.teamId ?? null,
					};
				}) ?? [],
	);

	const createMutation = useCreateEntryPoint({
		onMutate: (tempId) => {
			setIsCreating(false);
			setExpandedId(tempId);
		},
		onSuccess: ({ id }) => {
			setExpandedId(id);
		},
	});

	const deleteMutation = useDeleteEntryPoint();

	const handleDelete = (id: string) => {
		deleteMutation.mutate(id);
	};

	const handleCreate = (rotationId: string) => {
		return createMutation.mutateAsync({ type: "rotation", rotationId, prompt: "", teamId: props.teamId });
	};

	const [isCreating, setIsCreating] = createSignal(false);
	const [expandedId, setExpandedId] = createSignal<string | null>(null);

	const handleCreateSuccess = (id: string) => {
		setIsCreating(false);
		setExpandedId(id);
	};

	const handleDeleteWithCollapse = (id: string) => {
		if (expandedId() === id) {
			setExpandedId(null);
		}
		handleDelete(id);
	};

	return (
		<div class="space-y-6">
			<Show when={!isCreating()}>
				<div class="flex justify-end">
					<Button onClick={() => setIsCreating(true)}>
						<Plus class="w-4 h-4 mr-2" />
						New Entry Point
					</Button>
				</div>
			</Show>

			<Show when={isCreating()}>
				<CreateTeamEntryPointForm
					teamId={props.teamId}
					rotations={rotationsQuery.data?.filter((r) => r.teamId === props.teamId) ?? []}
					onCancel={() => setIsCreating(false)}
					onSubmit={async (rotationId) => {
						const { id } = await handleCreate(rotationId);
						handleCreateSuccess(id);
					}}
					isSubmitting={() => createMutation.isPending}
				/>
			</Show>

			<Show when={entryPoints().length > 0} fallback={!isCreating() && <EntryPointsEmptyState />}>
				<div class="space-y-3">
					<Index each={entryPoints()}>
						{(ep) => (
							<EntryPointCard
								entryPoint={ep()}
								onDelete={() => handleDeleteWithCollapse(ep().id)}
								isExpanded={expandedId() === ep().id}
								onToggle={() => setExpandedId(expandedId() === ep().id ? null : ep().id)}
							/>
						)}
					</Index>
				</div>
			</Show>
		</div>
	);
}

function CreateTeamEntryPointForm(props: {
	teamId: string;
	rotations: { id: string; name: string; shiftLength: string }[];
	onCancel: () => void;
	onSubmit: (rotationId: string) => void;
	isSubmitting: () => boolean;
}) {
	const [selectedRotationId, setSelectedRotationId] = createSignal("");

	const handleSubmit = (e: Event) => {
		e.preventDefault();
		props.onSubmit(selectedRotationId());
	};

	return (
		<div class="border border-border rounded-lg bg-muted/20 overflow-hidden">
			<div class="flex items-center justify-between px-4 py-3 border-b border-border">
				<h4 class="text-sm font-medium text-foreground">Add Entry Point to Team</h4>
				<Button variant="ghost" size="icon" class="h-8 w-8 cursor-pointer" onClick={props.onCancel}>
					<X class="w-4 h-4" />
				</Button>
			</div>
			<form onSubmit={handleSubmit} class="p-4 space-y-4">
				<div class="space-y-2">
					<Label>Select Rotation</Label>
					<Show
						when={props.rotations.length > 0}
						fallback={
							<p class="w-full text-left text-sm text-muted-foreground p-2">
								This team has not set up any rotations yet.{" "}
								<Link to="/teams/$teamId/rotations" params={{ teamId: props.teamId }} class="text-blue-600 hover:text-blue-700">
									Create a rotation first
								</Link>
								.
							</p>
						}
					>
						<Select
							value={selectedRotationId()}
							onChange={(value) => value && setSelectedRotationId(value)}
							options={props.rotations.map((r) => r.id)}
							itemComponent={(itemProps) => {
								const rotation = props.rotations.find((r) => r.id === itemProps.item.rawValue);
								return (
									<SelectItem item={itemProps.item} class="w-full">
										<div class="flex items-center gap-2 w-full">
											<div class="flex items-center justify-center w-6 h-6 rounded bg-blue-100/50 text-blue-600">
												<Repeat class="w-3.5 h-3.5" />
											</div>
											<div class="flex flex-col items-start gap-0.5">
												<span class="text-sm font-medium leading-none">{rotation?.name}</span>
												<span class="text-xs text-muted-foreground">Every {rotation?.shiftLength}</span>
											</div>
										</div>
									</SelectItem>
								);
							}}
						>
							<SelectTrigger class="w-full h-auto py-2">
								<SelectValue<string>>
									{(state) => {
										const rotation = props.rotations.find((r) => r.id === state.selectedOption());
										if (!rotation) return <span class="text-muted-foreground">Select a rotation...</span>;
										return (
											<div class="flex items-center gap-2">
												<div class="flex items-center justify-center w-5 h-5 rounded bg-blue-100/50 text-blue-600">
													<Repeat class="w-3 h-3" />
												</div>
												<span>{rotation.name}</span>
											</div>
										);
									}}
								</SelectValue>
							</SelectTrigger>
							<SelectContent />
						</Select>
					</Show>
				</div>
				<div class="flex justify-end gap-2">
					<Button type="button" variant="ghost" onClick={props.onCancel}>
						Cancel
					</Button>
					<Button type="submit" disabled={!selectedRotationId() || props.isSubmitting()}>
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

function ListSkeleton(props: { rows?: number } = {}) {
	return (
		<div class="space-y-6">
			<div class="flex justify-end">
				<Skeleton class="h-10 w-32" />
			</div>
			<div class="space-y-3">
				<For each={Array.from({ length: props.rows ?? 3 })}>{() => <Skeleton class="h-10 w-full" />}</For>
			</div>
		</div>
	);
}
