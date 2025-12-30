import { createFileRoute } from "@tanstack/solid-router";
import { ExternalLink, LoaderCircle, Plus, Users, X } from "lucide-solid";
import { createSignal, For, Show, Suspense } from "solid-js";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { ConfigCard, ConfigCardActions, ConfigCardDeleteButton, ConfigCardIcon, ConfigCardRow, ConfigCardTitle } from "~/components/ui/config-card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Skeleton } from "~/components/ui/skeleton";
import type { getTeams } from "~/lib/teams/teams";
import { useCreateTeam, useDeleteTeam, useTeams } from "~/lib/teams/teams.hooks";

export const Route = createFileRoute("/_authed/config/teams")({
	component: TeamsConfig,
});

function TeamsConfig() {
	return (
		<Card class="p-6">
			<Suspense fallback={<TeamsContentSkeleton />}>
				<TeamsContent />
			</Suspense>
		</Card>
	);
}

function TeamsContent() {
	const teamsQuery = useTeams();
	const teams = () => teamsQuery.data ?? [];

	const [isCreating, setIsCreating] = createSignal(false);

	const createMutation = useCreateTeam({
		onMutate: () => {
			setIsCreating(false);
		},
	});

	const deleteMutation = useDeleteTeam();

	const handleCreate = (name: string) => {
		createMutation.mutate({ name });
	};

	const handleDelete = (id: string) => {
		deleteMutation.mutate(id);
	};

	return (
		<div class="space-y-6">
			<Show when={!isCreating()} fallback={<CreateTeamForm onSubmit={handleCreate} onCancel={() => setIsCreating(false)} isSubmitting={() => createMutation.isPending} />}>
				<Button onClick={() => setIsCreating(true)} disabled={createMutation.isPending}>
					<Plus class="w-4 h-4" />
					Create Team
				</Button>
			</Show>

			<Show
				when={teams().length > 0}
				fallback={
					<Show when={!isCreating()}>
						<TeamsEmptyState />
					</Show>
				}
			>
				<div class="space-y-3">
					<For each={teams()}>
						{(team) => <TeamCard team={team} onDelete={() => handleDelete(team.id)} isDeleting={deleteMutation.isPending && deleteMutation.variables === team.id} />}
					</For>
				</div>
			</Show>

			<TeamsFooter count={teams().filter((team) => team.memberCount > 0).length} />
		</div>
	);
}

// --- Create Team Form ---

interface CreateTeamFormProps {
	onSubmit: (name: string) => void;
	onCancel: () => void;
	isSubmitting: () => boolean;
}

function CreateTeamForm(props: CreateTeamFormProps) {
	const [name, setName] = createSignal("");

	const handleSubmit = (e: Event) => {
		e.preventDefault();
		if (name().trim()) {
			props.onSubmit(name().trim());
		}
	};

	return (
		<div class="border border-border rounded-lg bg-muted/20 overflow-hidden">
			<div class="flex items-center justify-between px-4 py-3 border-b border-border">
				<h4 class="text-sm font-medium text-foreground">Create new team</h4>
				<Button variant="ghost" size="icon" class="h-8 w-8 cursor-pointer" onClick={props.onCancel}>
					<X class="w-4 h-4" />
				</Button>
			</div>
			<form onSubmit={handleSubmit} class="p-4 space-y-4">
				<div class="space-y-2">
					<Label for="team-name">Name</Label>
					<Input id="team-name" placeholder="e.g., Backend Team" value={name()} onInput={(e) => setName(e.currentTarget.value)} autofocus />
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

// --- Team Card ---

type Team = Awaited<ReturnType<typeof getTeams>>[number];

interface TeamCardProps {
	team: Team;
	onDelete: () => void;
	isDeleting: boolean;
}

function TeamCard(props: TeamCardProps) {
	const navigate = Route.useNavigate();

	return (
		<ConfigCard>
			<ConfigCardRow onClick={() => navigate({ to: `/teams/${props.team.id}` })} class="hover:bg-muted/50 transition-colors cursor-pointer">
				<Show
					when={props.team.imageUrl}
					fallback={
						<ConfigCardIcon variant="blue" size="sm">
							<Users class="w-4 h-4" />
						</ConfigCardIcon>
					}
				>
					{(imageUrl) => <img src={imageUrl()} alt={props.team.name} class="w-8 h-8 rounded-lg object-cover shrink-0" />}
				</Show>

				<ConfigCardTitle class="flex-1">{props.team.name}</ConfigCardTitle>

				<div class="flex items-center gap-3 shrink-0">
					<span class="text-sm text-muted-foreground">
						{props.team.memberCount} member{props.team.memberCount !== 1 && "s"}
					</span>

					<ConfigCardActions animated>
						<ConfigCardDeleteButton onDelete={props.onDelete} isDeleting={props.isDeleting} />
					</ConfigCardActions>
					<ExternalLink class="w-4 h-4 text-muted-foreground" />
				</div>
			</ConfigCardRow>
		</ConfigCard>
	);
}

// --- Footer ---

interface TeamsFooterProps {
	count: number;
}

function TeamsFooter(props: TeamsFooterProps) {
	return (
		<Show when={props.count > 0}>
			<div class="pt-4 border-t border-border">
				<p class="text-sm text-muted-foreground">
					<span class="font-medium text-foreground">{props.count}</span> team
					{props.count !== 1 && "s"} configured
				</p>
			</div>
		</Show>
	);
}

// --- Skeleton ---

function TeamsContentSkeleton() {
	return (
		<div class="space-y-6">
			<Skeleton class="h-10 w-32" />
			<div class="space-y-3">
				<TeamCardSkeleton />
				<TeamCardSkeleton />
			</div>
			<Skeleton variant="text" class="h-4 w-24" />
		</div>
	);
}

function TeamCardSkeleton() {
	return (
		<div class="border border-border rounded-lg bg-muted/30 p-4">
			<div class="flex items-center gap-3">
				<Skeleton variant="circular" class="w-8 h-8" />
				<Skeleton variant="text" class="h-4 w-32 flex-1" />
				<Skeleton variant="text" class="h-4 w-20" />
			</div>
		</div>
	);
}

// --- Empty State ---

function TeamsEmptyState() {
	return (
		<div class="flex flex-col items-center justify-center py-12 border border-dashed border-border rounded-lg">
			<div class="relative mb-4">
				<div class="absolute inset-0 bg-teal-400/20 rounded-full blur-xl animate-pulse" />
				<div class="relative p-3 rounded-full bg-gradient-to-br from-teal-100 to-teal-50 border border-teal-200/60">
					<Users class="w-8 h-8 text-teal-600" />
				</div>
			</div>
			<h3 class="text-lg font-medium text-foreground mb-1">No teams yet</h3>
			<p class="text-sm text-muted-foreground text-center max-w-sm">Create a team to organize your users and assign them to rotations and entry points.</p>
		</div>
	);
}
