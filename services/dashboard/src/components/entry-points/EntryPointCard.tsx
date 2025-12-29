import { ChevronDown, ChevronUp, LoaderCircle, Plus, Star, TriangleAlert, Users } from "lucide-solid";
import { createMemo, createSignal, Index, type JSX, Show } from "solid-js";
import { SlackAvatar } from "~/components/SlackEntityPicker";
import { AutoSaveTextarea } from "~/components/ui/auto-save-textarea";
import { Button } from "~/components/ui/button";
import { ConfigCard, ConfigCardActions, ConfigCardDeleteButton, ConfigCardRow, ConfigCardTitle } from "~/components/ui/config-card";
import { Skeleton } from "~/components/ui/skeleton";
import { useSlackUser } from "~/lib/useSlackUser";

export type EntryPoint = {
	id: string;
	prompt: string;
	isFallback: boolean;
} & ({ type: "user"; assigneeId: string } | { type: "rotation"; rotationId: string });

export interface EntryPointCardProps {
	entryPoint: EntryPoint;
	rotation?: { id: string; name: string; currentAssignee: string };
	index?: number;
	onDelete: (id: string) => void;
	onUpdatePrompt: (prompt: string) => Promise<void>;
	onSetFallback: (id: string) => void;
	isDeleting: boolean;
	isSettingFallback: boolean;
	isExpanded: boolean;
	onToggle: () => void;
}

export function EntryPointCard(props: EntryPointCardProps) {
	const handleSave = async (value: string) => {
		await props.onUpdatePrompt(value);
	};

	const assignee = createMemo(() => {
		if (props.entryPoint.type === "user") {
			return props.entryPoint.assigneeId;
		} else if (props.entryPoint.type === "rotation") {
			return props.rotation?.currentAssignee ?? "N/A";
		} else {
			return "N/A";
		}
	});

	const getFirstLine = (text: string) => {
		if (!text) return "";
		const firstLine = text.split("\n")[0];
		return firstLine.length > 80 ? `${firstLine.slice(0, 80)}...` : firstLine;
	};

	const hasMissingPrompt = () => !props.entryPoint.prompt.trim();
	const incomplete = () => hasMissingPrompt() && !props.isExpanded && !props.entryPoint.isFallback;

	const user = useSlackUser(assignee);

	const name = createMemo(() => {
		if (props.entryPoint.type === "rotation") {
			return props.rotation?.name ?? "N/A";
		}
		return user()?.name ?? props.entryPoint.assigneeId;
	});

	return (
		<ConfigCard hasWarning={incomplete()} isActive={props.isExpanded}>
			<ConfigCardRow onClick={props.onToggle}>
				<SlackAvatar id={assignee()} />

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
									props.onSetFallback(props.entryPoint.id);
								}}
								disabled={props.isSettingFallback}
							>
								<Show when={props.isSettingFallback} fallback={<Star class="w-3 h-3 mr-1" />}>
									<LoaderCircle class="w-3 h-3 animate-spin mr-1" />
								</Show>
							</Button>
						</Show>

						<ConfigCardDeleteButton onDelete={() => props.onDelete(props.entryPoint.id)} isDeleting={props.isDeleting} alwaysVisible />
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
			<p class="text-sm text-muted-foreground text-center max-w-sm">Add rotations or Slack users to define entry points for incident routing.</p>
		</div>
	);
}

// --- List Component ---

export interface EntryPointsListProps {
	entryPoints: EntryPoint[];
	rotations: { id: string; name: string; currentAssignee: string }[];
	onDelete: (id: string) => void;
	onUpdatePrompt: (id: string, prompt: string) => Promise<void>;
	onSetFallback: (id: string) => void;
	isDeletingId: string | null;
	isSettingFallbackId: string | null;
	createContent: (props: { onCancel: () => void; onSuccess: (id: string) => void }) => JSX.Element;
	createButtonText?: string;
	createButtonPosition?: "left" | "right";
	initiallyExpandedId?: string | null;
	onExpand?: (id: string | null) => void;
}

export function EntryPointsList(props: EntryPointsListProps) {
	const [expandedId, setExpandedId] = createSignal<string | null>(props.initiallyExpandedId ?? null);
	const [isCreating, setIsCreating] = createSignal(false);

	const toggleExpanded = (id: string) => {
		const newId = expandedId() === id ? null : id;
		setExpandedId(newId);
		props.onExpand?.(newId);
	};

	const handleCreateSuccess = (id: string) => {
		setIsCreating(false);
		setExpandedId(id);
		props.onExpand?.(id);
	};

	const handleDelete = (id: string) => {
		if (expandedId() === id) {
			setExpandedId(null);
			props.onExpand?.(null);
		}
		props.onDelete(id);
	};

	return (
		<div class="space-y-6">
			<Show when={!isCreating()}>
				<div class={`flex ${props.createButtonPosition === "right" ? "justify-end" : "justify-start"}`}>
					<Button onClick={() => setIsCreating(true)}>
						<Plus class="w-4 h-4 mr-2" />
						{props.createButtonText ?? "New Entry Point"}
					</Button>
				</div>
			</Show>

			<Show when={isCreating()}>
				{props.createContent({
					onCancel: () => setIsCreating(false),
					onSuccess: handleCreateSuccess,
				})}
			</Show>

			<Show when={props.entryPoints.length > 0} fallback={!isCreating() && <EntryPointsEmptyState />}>
				<div class="space-y-3">
					<Index each={props.entryPoints}>
						{(entryPoint, index) => {
							const ep = entryPoint();
							return (
								<EntryPointCard
									entryPoint={ep}
									rotation={ep.type === "rotation" ? props.rotations.find((r) => r.id === ep.rotationId) : undefined}
									index={index}
									onDelete={handleDelete}
									onUpdatePrompt={(prompt) => props.onUpdatePrompt(ep.id, prompt)}
									onSetFallback={props.onSetFallback}
									isDeleting={props.isDeletingId === ep.id}
									isSettingFallback={props.isSettingFallbackId === ep.id}
									isExpanded={expandedId() === ep.id}
									onToggle={() => toggleExpanded(ep.id)}
								/>
							);
						}}
					</Index>
				</div>
			</Show>
		</div>
	);
}
