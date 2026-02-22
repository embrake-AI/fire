import { createFileRoute } from "@tanstack/solid-router";
import { Plus, Users as UsersIcon } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Show, Suspense } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { EntityPicker } from "~/components/EntityPicker";
import { UserAvatar } from "~/components/UserAvatar";
import { Button } from "~/components/ui/button";
import { ConfigCard, ConfigCardActions, ConfigCardContent, ConfigCardDeleteButton, ConfigCardRow, ConfigCardTitle } from "~/components/ui/config-card";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Skeleton } from "~/components/ui/skeleton";
import { useAddSlackUserAsTeamMember, useAddTeamMember, useRemoveTeamMember } from "~/lib/teams/teams.hooks";
import { usePossibleSlackUsers, useUsers } from "~/lib/users/users.hooks";

export const Route = createFileRoute("/_authed/teams/$teamId/users")({
	component: TeamUsersPage,
});

function TeamUsersPage() {
	const params = Route.useParams();

	return (
		<Suspense fallback={<ListSkeleton rows={3} />}>
			<Show when={params().teamId}>{(id) => <TeamUsers teamId={id()} />}</Show>
		</Suspense>
	);
}

function TeamUsers(props: { teamId: string }) {
	const usersQuery = useUsers();
	const [members, setMembers] = createStore<NonNullable<typeof usersQuery.data>>([]);
	createEffect(() => {
		setMembers(reconcile(usersQuery.data?.filter((u) => u.teams.some((membership) => membership.id === props.teamId)) ?? [], { key: "id" }));
	});
	const removeMemberMutation = useRemoveTeamMember();

	const handleRemoveMember = async (userId: string) => {
		removeMemberMutation.mutate({ teamId: props.teamId, userId });
	};

	return (
		<div class="space-y-6">
			<div class="flex justify-end">
				<AddMemberSelector teamId={props.teamId} />
			</div>

			<Show when={members.length === 0}>
				<div class="flex flex-col items-center justify-center py-12 border border-dashed border-border rounded-lg">
					<div class="relative mb-4">
						<div class="absolute inset-0 bg-blue-400/20 rounded-full blur-xl animate-pulse" />
						<div class="relative p-3 rounded-full bg-linear-to-br from-blue-100 to-blue-50 border border-blue-200/60">
							<UsersIcon class="w-8 h-8 text-blue-600" />
						</div>
					</div>
					<h3 class="text-lg font-medium text-foreground mb-1">No members yet</h3>
					<p class="text-sm text-muted-foreground text-center max-w-sm">Add users to this team to assign them to rotations.</p>
				</div>
			</Show>

			<div class="space-y-3">
				<For each={members}>
					{(member) => {
						return (
							<ConfigCard>
								<ConfigCardRow>
									<UserAvatar name={() => member.name} avatar={() => member.image ?? undefined} />
									<ConfigCardContent>
										<ConfigCardTitle>{member.name}</ConfigCardTitle>
									</ConfigCardContent>
									<ConfigCardActions animated>
										<ConfigCardDeleteButton
											onDelete={() => handleRemoveMember(member.id)}
											isDeleting={removeMemberMutation.isPending && removeMemberMutation.variables?.userId === member.id}
										/>
									</ConfigCardActions>
								</ConfigCardRow>
							</ConfigCard>
						);
					}}
				</For>
			</div>
		</div>
	);
}

function AddMemberSelector(props: { teamId: string }) {
	const [open, setOpen] = createSignal(false);
	const addTeamMemberMutation = useAddTeamMember();
	const addSlackUserMutation = useAddSlackUserAsTeamMember();

	const possibleSlackUsers = usePossibleSlackUsers();
	const combinedEntities = createMemo(() => {
		return possibleSlackUsers().filter((user) => {
			if (user.type === "user") {
				return !user.teams.some((membership) => membership.id === props.teamId);
			}
			return true;
		});
	});

	const handleAdd = async (entity: { id: string; name: string; avatar?: string | null; type: "user" | "slack" }) => {
		if (entity.type === "user") {
			addTeamMemberMutation.mutate({ teamId: props.teamId, userId: entity.id });
		} else {
			addSlackUserMutation.mutate({
				teamId: props.teamId,
				slackUserId: entity.id,
				name: entity.name,
				avatar: entity.avatar,
			});
		}
		setOpen(false);
	};

	return (
		<Popover open={open()} onOpenChange={setOpen}>
			<PopoverTrigger as={Button}>
				<Plus class="w-4 h-4 mr-2" />
				Add Member
			</PopoverTrigger>
			<PopoverContent class="p-0" style={{ width: "200px" }}>
				<EntityPicker onSelect={handleAdd} entities={combinedEntities} placeholder="Select a user" />
			</PopoverContent>
		</Popover>
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
