import type { IS } from "@fire/common";
import { useQueryClient } from "@tanstack/solid-query";
import type { Accessor } from "solid-js";
import { createMemo, createSignal, For, Show } from "solid-js";
import { EntityPicker } from "~/components/EntityPicker";
import { UserDisplay } from "~/components/MaybeUser";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger } from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { getSeverity, getStatus } from "~/lib/incident-config";
import { useUpdateIncidentAssignee, useUpdateIncidentSeverity, useUpdateIncidentStatus } from "~/lib/incidents/incidents.hooks";
import { usePossibleSlackUsers, useUserBySlackId } from "~/lib/users/users.hooks";

type UpdatableIncidentStatus = Exclude<IS["status"], "open">;

export function IncidentHeader(props: { incident: Accessor<IS> }) {
	const queryClient = useQueryClient();
	const incident = () => props.incident();
	const updateSeverityMutation = useUpdateIncidentSeverity(() => incident().id);
	const updateAssigneeMutation = useUpdateIncidentAssignee(() => incident().id);
	const updateStatusMutation = useUpdateIncidentStatus(() => incident().id, {
		onSuccess: async (status) => {
			if (status === "resolved" || status === "declined") {
				const previousIncidents = queryClient.getQueryData<IS[]>(["incidents"]);
				if (previousIncidents) {
					const newIncidents = previousIncidents.filter((i) => i.id !== incident().id);
					queryClient.setQueryData(["incidents"], newIncidents);
				}
				await queryClient.invalidateQueries({ queryKey: ["incidents"] });
			}
		},
	});

	const user = useUserBySlackId(() => incident().assignee.slackId);

	const status = () => getStatus(incident().status);

	const [open, setOpen] = createSignal(false);

	const [statusDialogOpen, setStatusDialogOpen] = createSignal(false);
	const [selectedStatus, setSelectedStatus] = createSignal<UpdatableIncidentStatus | null>(null);
	const [statusMessage, setStatusMessage] = createSignal("");
	const selectedStatusConfig = createMemo(() => {
		const nextStatus = selectedStatus();
		return nextStatus ? getStatus(nextStatus) : null;
	});

	const availableTransitions = createMemo<readonly UpdatableIncidentStatus[]>(() => {
		const current = incident().status;
		if (current === "open") return ["mitigating", "resolved", "declined"] as const;
		if (current === "mitigating") return ["resolved", "declined"] as const;
		return [] as const;
	});

	const handleStatusClick = (newStatus: UpdatableIncidentStatus) => {
		setSelectedStatus(newStatus);
		setStatusMessage("");
		setStatusDialogOpen(true);
	};

	const handleStatusConfirm = async () => {
		const newStatus = selectedStatus();
		if (!newStatus || !statusMessage().trim()) return;

		await updateStatusMutation.mutateAsync({ status: newStatus, message: statusMessage() });
		setStatusDialogOpen(false);
		setSelectedStatus(null);
		setStatusMessage("");
	};

	const severityConfig = () => getSeverity(incident().severity);

	const possibleSlackUsers = usePossibleSlackUsers();

	return (
		<div class="space-y-6">
			<Dialog open={statusDialogOpen()} onOpenChange={setStatusDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							Update Status to <span>{selectedStatusConfig()?.label ?? ""}</span>
						</DialogTitle>
						<DialogDescription>
							{selectedStatus() === "declined" ? "Please provide a reason for declining this incident." : "Please provide a message explaining this status change."}
						</DialogDescription>
					</DialogHeader>
					<div class="py-4">
						<Textarea
							placeholder={selectedStatus() === "declined" ? "Describe why this incident is being declined..." : "Describe what changed..."}
							value={statusMessage()}
							onInput={(e) => setStatusMessage(e.currentTarget.value)}
							class="min-h-25"
						/>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setStatusDialogOpen(false)}>
							Cancel
						</Button>
						<Button onClick={handleStatusConfirm} disabled={!statusMessage().trim() || updateStatusMutation.isPending}>
							{updateStatusMutation.isPending ? "Updating..." : "Confirm"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<div class="space-y-4">
				<div class="flex items-start justify-between gap-4">
					<h1 class="text-3xl font-bold tracking-tight">{incident().title}</h1>
					<Show
						when={availableTransitions().length > 0}
						fallback={
							<Badge round class={`${status().bg} ${status().color} border-transparent h-8 px-3 text-sm shrink-0`}>
								<span class={`w-2 h-2 rounded-full mr-2 ${status().dot}`} />
								{status().label}
							</Badge>
						}
					>
						<Popover>
							<PopoverTrigger
								as={Badge}
								round
								class={`${status().bg} ${status().color} border-transparent h-8 px-3 text-sm shrink-0 cursor-pointer hover:opacity-80 transition-opacity`}
							>
								<span class={`w-2 h-2 rounded-full mr-2 ${status().dot}`} />
								{status().label}
							</PopoverTrigger>
							<PopoverContent class="w-48 p-2">
								<div class="space-y-1">
									<p class="text-xs text-muted-foreground px-2 py-1">Change status to:</p>
									<For each={availableTransitions()}>
										{(newStatus) => {
											const config = getStatus(newStatus);
											return (
												<button
													type="button"
													class="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted transition-colors cursor-pointer text-left"
													onClick={() => handleStatusClick(newStatus)}
												>
													<span class={`w-2 h-2 rounded-full ${config.dot}`} />
													<span class="capitalize text-sm">{config.label}</span>
												</button>
											);
										}}
									</For>
								</div>
							</PopoverContent>
						</Popover>
					</Show>
				</div>
				<div class="flex flex-wrap items-center gap-3">
					<Select
						value={incident().severity}
						onChange={(val) => val && updateSeverityMutation.mutate(val)}
						options={["low", "medium", "high"]}
						itemComponent={(itemProps) => {
							const config = getSeverity(itemProps.item.rawValue);
							return (
								<SelectItem item={itemProps.item}>
									<div class="flex items-center gap-2">
										<div class={`w-2 h-2 rounded-full ${config.dot}`} />
										<span class="capitalize">{itemProps.item.rawValue}</span>
									</div>
								</SelectItem>
							);
						}}
					>
						<SelectTrigger class="w-32 h-8 gap-2 bg-muted/50 border-transparent hover:bg-muted">
							<div class={`w-2 h-2 rounded-full ${severityConfig().dot}`} />
							<span class="capitalize text-sm">{incident().severity}</span>
						</SelectTrigger>
						<SelectContent />
					</Select>

					<span class="text-muted-foreground/40">·</span>

					<Popover open={open()} onOpenChange={setOpen}>
						<PopoverTrigger as={Button} variant="ghost" size="sm" class="h-8 gap-2 bg-muted/50 hover:bg-muted font-normal">
							<UserDisplay user={user} withName />
						</PopoverTrigger>
						<PopoverContent class="p-0 w-70">
							<EntityPicker
								entities={possibleSlackUsers}
								onSelect={(entity) => {
									updateAssigneeMutation.mutate(entity.type === "user" ? entity.slackId : entity.id);
									setOpen(false);
								}}
								selectedId={incident().assignee.slackId}
								placeholder="Change assignee..."
								emptyMessage="No users found."
							/>
						</PopoverContent>
					</Popover>
				</div>
			</div>
		</div>
	);
}
