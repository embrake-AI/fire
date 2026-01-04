import { ChevronDown, ChevronUp, Star, TriangleAlert, Users } from "lucide-solid";
import { createMemo, Show } from "solid-js";
import { UserAvatar } from "~/components/UserAvatar";
import { AutoSaveTextarea } from "~/components/ui/auto-save-textarea";
import { Button } from "~/components/ui/button";
import { ConfigCard, ConfigCardActions, ConfigCardDeleteButton, ConfigCardRow, ConfigCardTitle } from "~/components/ui/config-card";
import { Skeleton } from "~/components/ui/skeleton";
import type { getEntryPoints } from "~/lib/entry-points/entry-points";
import { useSetFallbackEntryPoint, useUpdateEntryPointPrompt } from "~/lib/entry-points/entry-points.hooks";
import { useRotations } from "~/lib/rotations/rotations.hooks";
import { useUsers } from "~/lib/users/users.hooks";

type EntryPoint = Awaited<ReturnType<typeof getEntryPoints>>[number];

export interface EntryPointCardProps {
	entryPoint: EntryPoint;
	isExpanded: boolean;
	onToggle: () => void;
	onDelete: () => void;
}

export function EntryPointCard(props: EntryPointCardProps) {
	const usersQuery = useUsers();
	const rotations = useRotations();
	const updatePromptMutation = useUpdateEntryPointPrompt();
	const setFallbackMutation = useSetFallbackEntryPoint();

	const handleSave = async (value: string) => {
		await updatePromptMutation.mutateAsync({ id: props.entryPoint.id, prompt: value });
	};

	const handleSetFallback = () => {
		setFallbackMutation.mutate(props.entryPoint.id);
	};

	const getFirstLine = (text: string) => {
		if (!text) return "";
		const firstLine = text.split("\n")[0];
		return firstLine.length > 80 ? `${firstLine.slice(0, 80)}...` : firstLine;
	};

	const hasMissingPrompt = () => !props.entryPoint.prompt.trim();
	const incomplete = () => hasMissingPrompt() && !props.isExpanded && !props.entryPoint.isFallback;

	const userData = createMemo(() => {
		if (props.entryPoint.type === "user") {
			return usersQuery.data?.find((u) => u.id === props.entryPoint.assigneeId);
		}
		const rotation = rotations.data?.find((r) => r.id === props.entryPoint.rotationId);
		if (rotation?.currentAssignee) {
			return usersQuery.data?.find((u) => u.id === rotation.currentAssignee);
		}
	});

	const name = createMemo(() => {
		if (props.entryPoint.type === "user") {
			return userData()?.name ?? "Unknown User";
		}
		return rotations.data?.find((r) => r.id === props.entryPoint.rotationId)?.name ?? "Unknown Rotation";
	});

	return (
		<ConfigCard hasWarning={incomplete()} isActive={props.isExpanded}>
			<ConfigCardRow onClick={props.onToggle}>
				<Show when={userData()}>{(user) => <UserAvatar name={() => user().name} avatar={() => user().image ?? undefined} />}</Show>

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
									handleSetFallback();
								}}
							>
								<span class="text-xs font-medium whitespace-nowrap">Set as fallback</span>
							</Button>
						</Show>

						<ConfigCardDeleteButton onDelete={props.onDelete} alwaysVisible />
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

export function EntryPointCardSkeleton() {
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

export function EntryPointsEmptyState() {
	return (
		<div class="flex flex-col items-center justify-center py-12 border border-dashed border-border rounded-lg">
			<div class="relative mb-4">
				<div class="absolute inset-0 bg-blue-400/20 rounded-full blur-xl animate-pulse" />
				<div class="relative p-3 rounded-full bg-gradient-to-br from-blue-100 to-blue-50 border border-blue-200/60">
					<Users class="w-8 h-8 text-blue-600" />
				</div>
			</div>
			<h3 class="text-lg font-medium text-foreground mb-1">No entry points yet</h3>
			<p class="text-sm text-muted-foreground text-center max-w-sm">Add rotations or users to define entry points for incident routing.</p>
		</div>
	);
}
