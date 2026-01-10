import { SHIFT_LENGTH_OPTIONS, type ShiftLength } from "@fire/common";
import { createFileRoute } from "@tanstack/solid-router";
import { LoaderCircle, Plus, X } from "lucide-solid";
import { createSignal, For, Index, Show, Suspense } from "solid-js";
import { RotationEmptyState } from "~/components/rotations/RotationCard";
import { RotationListCard } from "~/components/rotations/RotationListCard";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Skeleton } from "~/components/ui/skeleton";
import { useCreateRotation, useDeleteRotation, useRotations } from "~/lib/rotations/rotations.hooks";

export const Route = createFileRoute("/_authed/teams/$teamId/rotations")({
	component: TeamRotationsPage,
});

function TeamRotationsPage() {
	const params = Route.useParams();

	return (
		<Suspense fallback={<ListSkeleton rows={1} />}>
			<Show when={params().teamId}>{(id) => <TeamRotations teamId={id()} />}</Show>
		</Suspense>
	);
}

function TeamRotations(props: { teamId: string }) {
	const rotationsQuery = useRotations();
	const teamRotations = () => rotationsQuery.data?.filter((r) => r.teamId === props.teamId) ?? [];

	const [isCreating, setIsCreating] = createSignal(false);
	const navigate = Route.useNavigate();
	const deleteMutation = useDeleteRotation();
	const createMutation = useCreateRotation({
		onMutate: () => {
			setIsCreating(false);
		},
	});

	const handleDelete = (id: string) => {
		deleteMutation.mutate(id);
	};

	const handleCreate = (name: string, shiftLength: ShiftLength) => {
		createMutation.mutate({ name, shiftLength, teamId: props.teamId });
	};

	return (
		<div class="space-y-6">
			<div class="flex justify-end">
				<Show when={!isCreating()}>
					<Button onClick={() => setIsCreating(true)}>
						<Plus class="w-4 h-4 mr-2" />
						New Rotation
					</Button>
				</Show>
			</div>

			<Show when={isCreating()}>
				<CreateRotationForm onSubmit={handleCreate} onCancel={() => setIsCreating(false)} isSubmitting={() => createMutation.isPending} />
			</Show>

			<Show when={teamRotations().length === 0 && !isCreating()}>
				<RotationEmptyState />
			</Show>

			<div class="space-y-3">
				<Index each={teamRotations()}>
					{(rotation) => (
						<RotationListCard
							rotation={rotation()}
							onOpen={() => navigate({ to: "/rotations/$rotationId", params: { rotationId: rotation().id } })}
							onDelete={() => handleDelete(rotation().id)}
							isDeleting={deleteMutation.isPending && deleteMutation.variables === rotation().id}
						/>
					)}
				</Index>
			</div>
		</div>
	);
}

function CreateRotationForm(props: { onSubmit: (name: string, shiftLength: ShiftLength) => void; onCancel: () => void; isSubmitting: () => boolean }) {
	const [name, setName] = createSignal("");
	const [shiftLength, setShiftLength] = createSignal<ShiftLength>("1 week");

	const handleSubmit = (e: Event) => {
		e.preventDefault();
		if (name().trim()) {
			props.onSubmit(name().trim(), shiftLength());
		}
	};

	return (
		<div class="border border-border rounded-lg bg-muted/20 overflow-hidden mb-4">
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
