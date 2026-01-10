import { Link } from "@tanstack/solid-router";
import { Clock, ExternalLink, RefreshCw, Users } from "lucide-solid";
import { createMemo, Show } from "solid-js";
import { UserAvatar } from "~/components/UserAvatar";
import { Badge } from "~/components/ui/badge";
import { ConfigCard, ConfigCardActions, ConfigCardDeleteButton, ConfigCardIcon, ConfigCardRow, ConfigCardTitle } from "~/components/ui/config-card";
import type { getRotations } from "~/lib/rotations/rotations";
import { useTeams } from "~/lib/teams/teams.hooks";
import { useUsers } from "~/lib/users/users.hooks";
import { formatShiftLength } from "./RotationCard";

type Rotation = Awaited<ReturnType<typeof getRotations>>[number];

interface RotationListCardProps {
	rotation: Rotation;
	onOpen: () => void;
	onDelete: () => void;
	isDeleting: boolean;
	showTeamBadge?: boolean;
}

export function RotationListCard(props: RotationListCardProps) {
	const usersQuery = useUsers();
	const teamsQuery = useTeams({ enabled: () => !!props.showTeamBadge });

	const currentAssignee = createMemo(() => usersQuery.data?.find((u) => u.id === props.rotation.currentAssignee));
	const team = createMemo(() => {
		if (!props.showTeamBadge || !props.rotation.teamId) return null;
		return teamsQuery.data?.find((t) => t.id === props.rotation.teamId);
	});

	return (
		<ConfigCard class={team() ? "relative overflow-visible" : undefined}>
			<Show when={team()}>
				{(t) => (
					<Link
						to="/teams/$teamId"
						params={{ teamId: t().id }}
						class="absolute -top-1.5 -left-1.5 z-10 flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 border border-blue-200 text-blue-600 hover:bg-blue-200 transition-colors shadow-sm"
						title={t().name}
						onClick={(e) => e.stopPropagation()}
					>
						<Show when={t().imageUrl} fallback={<Users class="w-2.5 h-2.5" />}>
							{(imageUrl) => <img src={imageUrl()} alt={t().name} class="w-full h-full rounded-full object-cover" />}
						</Show>
					</Link>
				)}
			</Show>
			<ConfigCardRow onClick={props.onOpen} class="hover:bg-muted/50 transition-colors cursor-pointer">
				<Show
					when={currentAssignee()}
					fallback={
						<ConfigCardIcon variant="violet" size="sm">
							<RefreshCw class="w-4 h-4" />
						</ConfigCardIcon>
					}
				>
					{(user) => <UserAvatar name={() => user().name} avatar={() => user().image ?? undefined} />}
				</Show>

				<ConfigCardTitle class="flex-1">{props.rotation.name}</ConfigCardTitle>

				<Badge variant="outline" class="font-normal text-xs shrink-0">
					<Clock class="w-3 h-3 mr-1" />
					{formatShiftLength(props.rotation.shiftLength)}
				</Badge>

				<div class="flex items-center gap-3 shrink-0">
					<Show when={props.rotation.assignees.length > 0} fallback={<span class="text-sm text-amber-600">No assignees configured</span>}>
						<span class="text-sm text-muted-foreground">
							{props.rotation.assignees.length} assignee{props.rotation.assignees.length !== 1 && "s"}
						</span>
					</Show>

					<ConfigCardActions animated>
						<ConfigCardDeleteButton onDelete={props.onDelete} isDeleting={props.isDeleting} disabledReason={props.rotation.isInUse ? "Used in an entry point" : undefined} />
					</ConfigCardActions>
					<ExternalLink class="w-4 h-4 text-muted-foreground" />
				</div>
			</ConfigCardRow>
		</ConfigCard>
	);
}
