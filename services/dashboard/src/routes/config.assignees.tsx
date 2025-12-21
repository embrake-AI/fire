import { createFileRoute, useRouter } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { ChevronLeft, LoaderCircle, Pencil, Plus, Trash2, TriangleAlert, User, Users, UsersRound, X } from "lucide-solid";
import { type Accessor, createEffect, createResource, createSignal, For, type Resource, Show } from "solid-js";
import { AutoSaveTextarea } from "~/components/ui/auto-save-textarea";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import {
	type Assignee,
	createAssignee,
	deleteAssignee,
	getAssignees,
	getSlackUserGroups,
	getSlackUsers,
	type SlackUser,
	type SlackUserGroup,
	updateAssignee,
} from "~/lib/assignees";
import { cn } from "~/lib/utils";

export const Route = createFileRoute("/config/assignees")({
	component: AssigneesConfig,
	loader: () => getAssignees(),
});

type AddStep = "closed" | "choose-type" | "select-user" | "select-group";

function AssigneesConfig() {
	const router = useRouter();
	const assignees = Route.useLoaderData();

	const [addStep, setAddStep] = createSignal<AddStep>("closed");
	const [isAdding, setIsAdding] = createSignal(false);
	const [deletingId, setDeletingId] = createSignal<string | null>(null);
	const [newlyCreatedId, setNewlyCreatedId] = createSignal<string | null>(null);

	const createAssigneeFn = useServerFn(createAssignee);
	const deleteAssigneeFn = useServerFn(deleteAssignee);
	const updateAssigneeFn = useServerFn(updateAssignee);
	const getSlackUsersFn = useServerFn(getSlackUsers);
	const getSlackUserGroupsFn = useServerFn(getSlackUserGroups);

	const [slackUsers, { refetch: refetchUsers }] = createResource(
		() => addStep() === "select-user",
		async (shouldFetch) => {
			if (!shouldFetch) return [];
			return getSlackUsersFn();
		},
	);

	const [slackGroups, { refetch: refetchGroups }] = createResource(
		() => addStep() === "select-group",
		async (shouldFetch) => {
			if (!shouldFetch) return [];
			return getSlackUserGroupsFn();
		},
	);

	const handleSelectUser = async (user: SlackUser) => {
		setIsAdding(true);
		try {
			const newAssignee = await createAssigneeFn({
				data: { id: user.id, type: "slack-user" },
			});
			setAddStep("closed");
			if (newAssignee?.id) {
				setNewlyCreatedId(newAssignee.id);
			}
			await router.invalidate({ sync: true });
		} finally {
			setIsAdding(false);
		}
	};

	const handleSelectGroup = async (group: SlackUserGroup) => {
		setIsAdding(true);
		try {
			const newAssignee = await createAssigneeFn({
				data: { id: group.id, type: "slack-user-group" },
			});
			setAddStep("closed");
			if (newAssignee?.id) {
				setNewlyCreatedId(newAssignee.id);
			}
			await router.invalidate({ sync: true });
		} finally {
			setIsAdding(false);
		}
	};

	const handleDelete = async (id: string) => {
		setDeletingId(id);
		try {
			await deleteAssigneeFn({ data: { id } });
			await router.invalidate({ sync: true });
			refetchUsers();
			refetchGroups();
		} finally {
			setDeletingId(null);
		}
	};

	const handleUpdatePrompt = async (id: string, prompt: string) => {
		await updateAssigneeFn({ data: { id, prompt } });
	};

	return (
		<Card class="p-6">
			<div class="space-y-6">
				<AddAssigneePicker
					step={addStep}
					setStep={setAddStep}
					slackUsers={slackUsers}
					slackGroups={slackGroups}
					isAdding={isAdding}
					onSelectUser={handleSelectUser}
					onSelectGroup={handleSelectGroup}
				/>

				<Show when={assignees().length > 0} fallback={<AssigneesEmptyState />}>
					<div class="space-y-3">
						<For each={assignees()}>
							{(assignee, index) => (
								<AssigneeCard
									assignee={assignee}
									name={assignee.name}
									index={index()}
									onDelete={handleDelete}
									onUpdatePrompt={handleUpdatePrompt}
									isDeleting={deletingId() === assignee.id}
									isNewlyCreated={newlyCreatedId() === assignee.id}
									onEditComplete={async () => {
										if (newlyCreatedId() === assignee.id) {
											setNewlyCreatedId(null);
										}
										await router.invalidate();
									}}
								/>
							)}
						</For>
					</div>
				</Show>

				<AssigneesFooter count={assignees().filter((a) => !!a.prompt).length} />
			</div>
		</Card>
	);
}

// --- Add Assignee Picker ---

interface AddAssigneePickerProps {
	step: Accessor<AddStep>;
	setStep: (step: AddStep) => void;
	slackUsers: Resource<SlackUser[]>;
	slackGroups: Resource<SlackUserGroup[]>;
	isAdding: Accessor<boolean>;
	onSelectUser: (user: SlackUser) => void;
	onSelectGroup: (group: SlackUserGroup) => void;
}

function AddAssigneePicker(props: AddAssigneePickerProps) {
	const handleCancel = () => props.setStep("closed");
	const handleBack = () => props.setStep("choose-type");

	return (
		<Show
			when={props.step() !== "closed"}
			fallback={
				<Button onClick={() => props.setStep("choose-type")}>
					<Plus class="w-4 h-4" />
					Add Assignee
				</Button>
			}
		>
			<div class="border border-border rounded-lg p-4 bg-muted/20">
				{/* Step: Choose type */}
				<Show when={props.step() === "choose-type"}>
					<div class="space-y-3">
						<div class="flex items-center justify-between">
							<h4 class="text-sm font-medium text-foreground">Add an assignee</h4>
							<Button variant="ghost" size="icon" class="h-8 w-8 cursor-pointer" onClick={handleCancel}>
								<X class="w-4 h-4" />
							</Button>
						</div>
						<div class="grid grid-cols-2 gap-3">
							<button
								type="button"
								onClick={() => props.setStep("select-user")}
								class="flex flex-col items-center gap-2 p-4 rounded-lg border border-border bg-background hover:bg-muted/50 hover:border-blue-300 transition-colors cursor-pointer"
							>
								<div class="p-2 rounded-full bg-blue-100">
									<User class="w-5 h-5 text-blue-600" />
								</div>
								<span class="text-sm font-medium">Slack User</span>
								<span class="text-xs text-muted-foreground">Individual team member</span>
							</button>
							<button
								type="button"
								onClick={() => props.setStep("select-group")}
								class="flex flex-col items-center gap-2 p-4 rounded-lg border border-border bg-background hover:bg-muted/50 hover:border-emerald-300 transition-colors cursor-pointer"
							>
								<div class="p-2 rounded-full bg-emerald-100">
									<UsersRound class="w-5 h-5 text-emerald-600" />
								</div>
								<span class="text-sm font-medium">User Group</span>
								<span class="text-xs text-muted-foreground">Team or rotation group</span>
							</button>
						</div>
					</div>
				</Show>

				{/* Step: Select user */}
				<Show when={props.step() === "select-user"}>
					<div class="space-y-3">
						<div class="flex items-center gap-2">
							<Button variant="ghost" size="icon" class="h-8 w-8 cursor-pointer" onClick={handleBack}>
								<ChevronLeft class="w-4 h-4" />
							</Button>
							<h4 class="text-sm font-medium text-foreground">Select a Slack user</h4>
							<div class="flex-1" />
							<Button variant="ghost" size="icon" class="h-8 w-8 cursor-pointer" onClick={handleCancel}>
								<X class="w-4 h-4" />
							</Button>
						</div>
						<Show
							when={!props.slackUsers.loading}
							fallback={
								<div class="flex items-center justify-center py-8">
									<LoaderCircle class="w-5 h-5 animate-spin text-muted-foreground" />
								</div>
							}
						>
							<Show when={(props.slackUsers() ?? []).length > 0} fallback={<div class="text-center py-6 text-sm text-muted-foreground">All users have been added</div>}>
								<div class="space-y-2 max-h-64 overflow-y-auto">
									<For each={props.slackUsers()}>
										{(user) => (
											<button
												type="button"
												onClick={() => props.onSelectUser(user)}
												disabled={props.isAdding()}
												class="w-full flex items-center gap-3 p-3 rounded-lg border border-border bg-background hover:bg-muted/50 hover:border-blue-300 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
											>
												<div class="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-600 font-medium text-sm">
													{user.name
														.split(" ")
														.map((n) => n[0])
														.join("")}
												</div>
												<div class="flex-1 text-left">
													<div class="text-sm font-medium">{user.name}</div>
													<div class="text-xs text-muted-foreground">{user.email}</div>
												</div>
												<code class="text-xs font-mono text-muted-foreground">{user.id}</code>
											</button>
										)}
									</For>
								</div>
							</Show>
						</Show>
					</div>
				</Show>

				{/* Step: Select group */}
				<Show when={props.step() === "select-group"}>
					<div class="space-y-3">
						<div class="flex items-center gap-2">
							<Button variant="ghost" size="icon" class="h-8 w-8 cursor-pointer" onClick={handleBack}>
								<ChevronLeft class="w-4 h-4" />
							</Button>
							<h4 class="text-sm font-medium text-foreground">Select a user group</h4>
							<div class="flex-1" />
							<Button variant="ghost" size="icon" class="h-8 w-8 cursor-pointer" onClick={handleCancel}>
								<X class="w-4 h-4" />
							</Button>
						</div>
						<Show
							when={!props.slackGroups.loading}
							fallback={
								<div class="flex items-center justify-center py-8">
									<LoaderCircle class="w-5 h-5 animate-spin text-muted-foreground" />
								</div>
							}
						>
							<Show when={(props.slackGroups() ?? []).length > 0} fallback={<div class="text-center py-6 text-sm text-muted-foreground">All user groups have been added</div>}>
								<div class="space-y-2 max-h-64 overflow-y-auto">
									<For each={props.slackGroups()}>
										{(group) => (
											<button
												type="button"
												onClick={() => props.onSelectGroup(group)}
												disabled={props.isAdding()}
												class="w-full flex items-center gap-3 p-3 rounded-lg border border-border bg-background hover:bg-muted/50 hover:border-emerald-300 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
											>
												<div class="flex items-center justify-center w-8 h-8 rounded-full bg-emerald-100 text-emerald-600">
													<UsersRound class="w-4 h-4" />
												</div>
												<div class="flex-1 text-left">
													<div class="text-sm font-medium">{group.name}</div>
													<div class="text-xs text-muted-foreground">
														@{group.handle} · {group.memberCount} members
													</div>
												</div>
												<code class="text-xs font-mono text-muted-foreground">{group.id}</code>
											</button>
										)}
									</For>
								</div>
							</Show>
						</Show>
					</div>
				</Show>
			</div>
		</Show>
	);
}

// --- Empty State ---

function AssigneesEmptyState() {
	return (
		<div class="flex flex-col items-center justify-center py-12 border border-dashed border-border rounded-lg">
			<div class="relative mb-4">
				<div class="absolute inset-0 bg-blue-400/20 rounded-full blur-xl animate-pulse" />
				<div class="relative p-3 rounded-full bg-gradient-to-br from-blue-100 to-blue-50 border border-blue-200/60">
					<Users class="w-8 h-8 text-blue-600" />
				</div>
			</div>
			<h3 class="text-lg font-medium text-foreground mb-1">No assignees yet</h3>
			<p class="text-sm text-muted-foreground text-center max-w-sm">Add Slack users or user groups to define who can be assigned to incidents.</p>
		</div>
	);
}

// --- Footer ---

interface AssigneesFooterProps {
	count: number;
}

function AssigneesFooter(props: AssigneesFooterProps) {
	return (
		<Show when={props.count > 0}>
			<div class="pt-4 border-t border-border">
				<p class="text-sm text-muted-foreground">
					<span class="font-medium text-foreground">{props.count}</span> assignee{props.count !== 1 && "s"} configured
				</p>
			</div>
		</Show>
	);
}

// --- Assignee Card ---

interface AssigneeCardProps {
	assignee: Assignee;
	name: string;
	index: number;
	onDelete: (id: string) => void;
	onUpdatePrompt: (id: string, prompt: string) => Promise<void>;
	isDeleting: boolean;
	isNewlyCreated: boolean;
	onEditComplete: () => void;
}

function AssigneeCard(props: AssigneeCardProps) {
	const [isEditing, setIsEditing] = createSignal(false);

	createEffect(() => {
		if (props.isNewlyCreated) {
			setIsEditing(true);
		}
	});

	const handleEditClick = () => {
		setIsEditing(true);
	};

	const handleEditComplete = () => {
		setIsEditing(false);
		props.onEditComplete();
	};

	const handleSave = async (value: string) => {
		await props.onUpdatePrompt(props.assignee.id, value);
	};

	const getFirstLine = (text: string) => {
		if (!text) return "";
		const firstLine = text.split("\n")[0];
		return firstLine.length > 80 ? `${firstLine.slice(0, 80)}...` : firstLine;
	};

	const hasMissingPrompt = () => !props.assignee.prompt.trim();
	const isGroup = () => props.assignee.type === "slack-user-group";

	return (
		<div
			class={cn(
				"group border rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors",
				hasMissingPrompt() && !isEditing() ? "border-amber-300 bg-amber-50/50" : "border-border",
			)}
		>
			<div class="flex items-center gap-3 p-4">
				<div
					class={cn(
						"flex items-center justify-center w-8 h-8 rounded-full font-medium text-sm shrink-0",
						hasMissingPrompt() && !isEditing() ? "bg-amber-100 text-amber-600" : isGroup() ? "bg-emerald-100 text-emerald-600" : "bg-blue-100 text-blue-600",
					)}
				>
					<Show
						when={isGroup()}
						fallback={
							<span>
								{props.name
									.split(" ")
									.map((n) => n[0])
									.join("")}
							</span>
						}
					>
						<UsersRound class="w-4 h-4" />
					</Show>
				</div>
				<div class="flex-1 min-w-0">
					<div class="flex items-center gap-2">
						<span class="text-sm font-medium">{props.name}</span>
						<Show when={!isEditing()}>
							<Show
								when={props.assignee.prompt.trim()}
								fallback={
									<span class="text-sm text-amber-600 flex items-center gap-1.5">
										<TriangleAlert class="w-3.5 h-3.5" />
										Missing prompt — will not be assigned
									</span>
								}
							>
								<span class="text-sm text-muted-foreground truncate">— {getFirstLine(props.assignee.prompt)}</span>
							</Show>
						</Show>

						<Show when={!isEditing()}>
							<button type="button" onClick={handleEditClick} class="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-background cursor-pointer">
								<Pencil class="w-3.5 h-3.5 text-muted-foreground" />
							</button>
						</Show>
					</div>
				</div>
				<Button
					variant="ghost"
					size="icon"
					class="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer"
					onClick={() => props.onDelete(props.assignee.id)}
					disabled={props.isDeleting}
				>
					<Show when={props.isDeleting} fallback={<Trash2 class="w-4 h-4" />}>
						<LoaderCircle class="w-4 h-4 animate-spin" />
					</Show>
				</Button>
			</div>

			<Show when={isEditing()}>
				<div class="px-4 pb-4">
					<AutoSaveTextarea
						id={`prompt-${props.assignee.id}`}
						label="Custom Prompt"
						placeholder="Assign this user when the incident..."
						value={props.assignee.prompt}
						onSave={handleSave}
						onBlur={handleEditComplete}
						rows={3}
						autoFocus
					/>
				</div>
			</Show>
		</div>
	);
}
