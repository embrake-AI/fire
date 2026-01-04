import { SHIFT_LENGTH_OPTIONS, type ShiftLength } from "@fire/common";
import { createFileRoute } from "@tanstack/solid-router";
import { LoaderCircle, Plus, X } from "lucide-solid";
import { type Accessor, createSignal, Index, Show, Suspense } from "solid-js";
import { RotationCard, RotationCardSkeleton, RotationEmptyState } from "~/components/rotations/RotationCard";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Skeleton } from "~/components/ui/skeleton";
import { useCreateRotation, useDeleteRotation, useRotations } from "~/lib/rotations/rotations.hooks";

export const Route = createFileRoute("/_authed/catalog/rotation")({
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
	const rotationsQuery = useRotations();
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
								showTeamBadge
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
