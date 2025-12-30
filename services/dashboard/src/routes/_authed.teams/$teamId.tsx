import { SHIFT_LENGTH_OPTIONS, type ShiftLength } from "@fire/common";
import { createFileRoute, Link } from "@tanstack/solid-router";
import { Check, ImageUp, LoaderCircle, Pencil, Plus, Repeat, Users as UsersIcon, X } from "lucide-solid";
import { createEffect, createMemo, createSignal, ErrorBoundary, For, Index, onCleanup, onMount, Show, Suspense } from "solid-js";
import { EntityPicker } from "~/components/EntityPicker";
import { EntryPointCard, EntryPointsEmptyState } from "~/components/entry-points/EntryPointCard";
import { RotationCard, RotationEmptyState } from "~/components/rotations/RotationCard";
import { UserAvatar } from "~/components/UserAvatar";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { ConfigCard, ConfigCardActions, ConfigCardContent, ConfigCardDeleteButton, ConfigCardRow, ConfigCardTitle } from "~/components/ui/config-card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Skeleton } from "~/components/ui/skeleton";
import { Tabs, TabsContent, TabsIndicator, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { useCreateEntryPoint, useDeleteEntryPoint, useEntryPoints } from "~/lib/entry-points/entry-points.hooks";
import { useCreateRotation, useDeleteRotation, useRotations } from "~/lib/rotations/rotations.hooks";
import { useAddTeamMember, useRemoveTeamMember, useTeams, useUpdateTeam } from "~/lib/teams/teams.hooks";
import { useUsers } from "~/lib/users/users.hooks";
import { cn } from "~/lib/utils/client";

function TeamDetailsPage() {
	const search = Route.useSearch();
	const navigate = Route.useNavigate();
	onMount(() => {
		if (!search().tab) {
			navigate({ to: ".", search: (prev) => ({ ...prev, tab: "users" }), replace: true });
		}
	});
	return <TeamDetails />;
}

export const Route = createFileRoute("/_authed/teams/$teamId")({
	component: () => (
		<ErrorBoundary
			fallback={(error) => (
				<div>
					Error {error.message} {error.stack}
				</div>
			)}
		>
			<TeamDetailsPage />
		</ErrorBoundary>
	),
	validateSearch: (search: { tab?: "users" | "rotations" | "entry-points" }) => ({
		tab: search.tab,
	}),
});

function TeamDetails() {
	const params = Route.useParams();
	const search = Route.useSearch();
	const teamsQuery = useTeams();
	const teamId = createMemo(() => params().teamId);
	const team = createMemo(() => {
		const id = teamId();
		return id ? teamsQuery.data?.find((t) => t.id === id) : undefined;
	});

	const tab = createMemo(() => search().tab);

	return (
		<div class="flex-1 bg-background p-6 md:p-8">
			<div class="max-w-5xl mx-auto space-y-8">
				<Suspense fallback={<TeamHeaderSkeleton />}>
					<Show when={team()} fallback={<div>Team not found</div>}>
						{(team) => <TeamHeader team={team()} />}
					</Show>
				</Suspense>

				<Tabs value={tab()}>
					<TabsList>
						<Link to={`/teams/$teamId`} search={{ tab: "users" }} params={{ teamId: params().teamId }}>
							<TabsTrigger value="users">Users</TabsTrigger>
						</Link>
						<Link to={`/teams/$teamId`} search={{ tab: "rotations" }} params={{ teamId: params().teamId }}>
							<TabsTrigger value="rotations">Rotations</TabsTrigger>
						</Link>
						<Link to={`/teams/$teamId`} search={{ tab: "entry-points" }} params={{ teamId: params().teamId }}>
							<TabsTrigger value="entry-points">Entry Points</TabsTrigger>
						</Link>
						<TabsIndicator />
					</TabsList>

					<div class="mt-6">
						<TabsContent value="users">
							<Suspense fallback={<ListSkeleton rows={3} />}>
								<Show when={teamId()}>{(id) => <TeamUsers teamId={id()} />}</Show>
							</Suspense>
						</TabsContent>
						<TabsContent value="rotations">
							<Suspense fallback={<ListSkeleton rows={1} />}>
								<Show when={teamId()}>{(id) => <TeamRotations teamId={id()} />}</Show>
							</Suspense>
						</TabsContent>
						<TabsContent value="entry-points">
							<Suspense fallback={<ListSkeleton rows={1} />}>
								<Show when={teamId()}>{(id) => <TeamEntryPoints teamId={id()} />}</Show>
							</Suspense>
						</TabsContent>
					</div>
				</Tabs>
			</div>
		</div>
	);
}

// --- Header & Edit ---

function TeamHeader(props: { team: { id: string; name: string; imageUrl: string | null; memberCount: number } }) {
	const updateTeamMutation = useUpdateTeam({
		onMutate: () => {
			setIsEditingName(false);
			setIsEditingImage(false);
		},
	});

	const [isEditingName, setIsEditingName] = createSignal(false);
	const [isEditingImage, setIsEditingImage] = createSignal(false);
	const [name, setName] = createSignal(props.team.name);
	const [imageFile, setImageFile] = createSignal<File | null>(null);
	const [droppedImageUrl, setDroppedImageUrl] = createSignal("");
	const [isUploadingImage, setIsUploadingImage] = createSignal(false);
	const [isDragActive, setIsDragActive] = createSignal(false);
	let fileInputRef: HTMLInputElement | undefined;

	const formatFileSize = (size: number) => {
		if (size < 1024) return `${size} B`;
		if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
		return `${(size / (1024 * 1024)).toFixed(1)} MB`;
	};

	const selectedFileDetails = createMemo(() => {
		const file = imageFile();
		return file ? { name: file.name, size: formatFileSize(file.size) } : null;
	});

	const [previewUrl, setPreviewUrl] = createSignal<string | null>(null);

	createEffect(() => {
		const file = imageFile();
		if (!file) {
			setPreviewUrl(null);
			return;
		}
		const objectUrl = URL.createObjectURL(file);
		setPreviewUrl(objectUrl);
		onCleanup(() => URL.revokeObjectURL(objectUrl));
	});

	const previewSource = createMemo(() => previewUrl() || droppedImageUrl() || props.team.imageUrl || "");

	const handleUpdateName = async () => {
		updateTeamMutation.mutate({ id: props.team.id, name: name() });
	};

	const handleUpdateImage = async () => {
		setIsUploadingImage(true);
		try {
			const file = imageFile();
			const url = droppedImageUrl().trim();
			let uploadedUrl = props.team.imageUrl || "";

			if (file || url) {
				const formData = new FormData();
				if (file) {
					formData.append("file", file);
				} else {
					formData.append("url", url);
				}

				const response = await fetch("/api/upload/team-image", {
					method: "POST",
					body: formData,
				});

				if (!response.ok) {
					throw new Error("Upload failed");
				}

				const data = (await response.json()) as { url: string };
				uploadedUrl = data.url;
			}

			setImageFile(null);
			setDroppedImageUrl("");
			updateTeamMutation.mutate({ id: props.team.id, imageUrl: uploadedUrl || null });
		} finally {
			setIsUploadingImage(false);
		}
	};

	const handleSelectedFile = (file: File | null) => {
		if (!file || !file.type.startsWith("image/")) {
			return;
		}
		setImageFile(file);
		setDroppedImageUrl("");
	};

	const normalizeImageUrl = (raw: string) => {
		const trimmed = raw.trim();
		if (!trimmed) return "";
		const directImagePattern = /\.(gif|png|jpe?g|webp)(\?.*)?$/i;
		if (directImagePattern.test(trimmed)) return trimmed;
		try {
			const parsed = new URL(trimmed);
			if (parsed.hostname.includes("giphy.com")) {
				const giphyMatch = parsed.pathname.match(/\/gifs\/(?:.+-)?([a-zA-Z0-9]+)$/);
				const id = giphyMatch?.[1];
				if (id) {
					return `https://media.giphy.com/media/${id}/giphy.gif`;
				}
			}
		} catch {
			// Fall through to regex extraction.
		}
		const match = trimmed.match(/https?:\/\/\S+/);
		return match ? match[0] : "";
	};

	const extractDroppedUrl = (event: DragEvent) => {
		const uriList = event.dataTransfer?.getData("text/uri-list") ?? "";
		const plainText = event.dataTransfer?.getData("text/plain") ?? "";
		const candidate = uriList
			.split(/\r?\n/)
			.map((line) => line.trim())
			.find((line) => line && !line.startsWith("#"));
		return candidate || plainText.trim();
	};

	const handleDroppedUrl = (rawUrl: string) => {
		const normalized = normalizeImageUrl(rawUrl);
		if (!normalized) return;
		setDroppedImageUrl(normalized);
		setImageFile(null);
	};

	const isSubmitting = () => updateTeamMutation.isPending;

	return (
		<div class="flex items-center gap-4 group">
			<button
				type="button"
				class="relative h-16 w-16 rounded-xl overflow-hidden cursor-pointer bg-gradient-to-br from-blue-100 to-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 shadow-sm p-0"
				onClick={() => setIsEditingImage(true)}
			>
				<Show when={props.team.imageUrl} fallback={<UsersIcon class="h-8 w-8" />}>
					{(imageUrl) => {
						return <img src={imageUrl()} alt={props.team.name} class="h-full w-full object-cover" />;
					}}
				</Show>

				<div
					class={cn("absolute inset-0 bg-black/60 flex items-center justify-center transition-opacity duration-200 opacity-0 hover:opacity-100", isEditingImage() && "opacity-100")}
				>
					<Pencil class="w-5 h-5 text-white" />
				</div>
			</button>

			<Dialog open={isEditingImage()} onOpenChange={setIsEditingImage}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Update Team Icon</DialogTitle>
					</DialogHeader>
					<div class="space-y-4 py-4">
						<div class="space-y-2">
							<Card
								class={cn("border-dashed bg-muted/30 transition-all", isDragActive() && "border-blue-300 bg-blue-50/60 shadow-md")}
								onDragOver={(event) => {
									event.preventDefault();
									setIsDragActive(true);
								}}
								onDragLeave={(event) => {
									event.preventDefault();
									setIsDragActive(false);
								}}
								onDrop={(event) => {
									event.preventDefault();
									setIsDragActive(false);
									const file = event.dataTransfer?.files?.[0] ?? null;
									if (file) {
										handleSelectedFile(file);
										return;
									}
									const droppedUrl = extractDroppedUrl(event);
									if (droppedUrl) {
										handleDroppedUrl(droppedUrl);
										return;
									}
									const items = event.dataTransfer?.items;
									if (items?.length) {
										for (const item of Array.from(items)) {
											if (item.kind === "string") {
												item.getAsString((value) => handleDroppedUrl(value));
											}
										}
									}
								}}
							>
								<CardContent class="p-4 space-y-3">
									<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
										<div class="space-y-1">
											<div class="flex items-center gap-2 text-sm font-medium text-foreground">
												<ImageUp class="w-4 h-4 text-blue-600" />
												<span>Select an image file</span>
											</div>
											<p class="text-xs text-muted-foreground">Choose or drop a file to replace the team icon.</p>
										</div>
										<div class="flex items-center gap-2">
											<Input
												ref={(el) => {
													fileInputRef = el;
												}}
												id="team-image-file"
												type="file"
												accept="image/*"
												class="hidden"
												onChange={(e) => {
													const file = e.currentTarget.files?.[0] ?? null;
													handleSelectedFile(file);
												}}
											/>
											<Button
												variant="outline"
												class="cursor-pointer"
												onClick={(e) => {
													e.stopPropagation();
													fileInputRef?.click();
												}}
											>
												<ImageUp class="w-4 h-4 mr-2" />
												Browse files
											</Button>
										</div>
									</div>
									<Show when={selectedFileDetails()}>
										{(details) => (
											<div class="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-xs">
												<span class="font-medium text-foreground">{details().name}</span>
												<span class="text-muted-foreground">{details().size}</span>
											</div>
										)}
									</Show>
								</CardContent>
							</Card>
						</div>
						<Show when={previewSource()}>
							{(src) => (
								<div class="flex justify-center">
									<div class="h-16 w-16 overflow-hidden rounded-xl border border-blue-200 bg-gradient-to-br from-blue-100 to-blue-50 shadow-sm">
										<img src={src()} alt="Preview" class="h-full w-full object-cover" />
									</div>
								</div>
							)}
						</Show>
						<div class="flex justify-end gap-2">
							<Button
								variant="ghost"
								onClick={(e) => {
									e.stopPropagation();
									setIsEditingImage(false);
								}}
							>
								Cancel
							</Button>
							<Button
								onClick={(e) => {
									e.stopPropagation();
									void handleUpdateImage();
								}}
								disabled={isSubmitting() || isUploadingImage() || (!imageFile() && !droppedImageUrl())}
							>
								{isSubmitting() || isUploadingImage() ? <LoaderCircle class="w-4 h-4 animate-spin" /> : "Save"}
							</Button>
						</div>
					</div>
				</DialogContent>
			</Dialog>

			<div class="flex-1">
				<div class="flex items-center gap-2">
					<Show
						when={isEditingName()}
						fallback={
							<button type="button" class="flex items-center gap-2 group/title cursor-pointer bg-transparent border-none p-0" onClick={() => setIsEditingName(true)}>
								<h1 class="text-2xl font-bold tracking-tight">{props.team.name}</h1>
								<Pencil class="w-4 h-4 text-muted-foreground opacity-0 group-hover/title:opacity-100 transition-opacity" />
							</button>
						}
					>
						<form
							class="flex items-center gap-2"
							onSubmit={(e) => {
								e.preventDefault();
								handleUpdateName();
							}}
							onFocusOut={(e) => {
								if (!e.currentTarget.contains(e.relatedTarget as Node) && !isSubmitting()) {
									setIsEditingName(false);
								}
							}}
							onKeyDown={(e) => {
								if (e.key === "Escape") {
									setIsEditingName(false);
								}
							}}
						>
							<Input value={name()} onInput={(e) => setName(e.currentTarget.value)} class="h-9 text-lg font-bold w-full max-w-sm" autofocus />
							<Button size="sm" type="submit" disabled={isSubmitting() || !name().trim()}>
								<Check class="w-4 h-4" />
							</Button>
						</form>
					</Show>
				</div>
				<p class="text-muted-foreground flex items-center gap-2 mt-1">
					<UsersIcon class="w-4 h-4" />
					<span>{props.team.memberCount} members</span>
				</p>
			</div>
		</div>
	);
}

// --- Users Tab ---

function TeamUsers(props: { teamId: string }) {
	const usersQuery = useUsers();
	const members = createMemo(() => usersQuery.data?.filter((u) => u.teamIds.includes(props.teamId)) ?? []);
	const removeMemberMutation = useRemoveTeamMember();

	const handleRemoveMember = async (userId: string) => {
		removeMemberMutation.mutate({ teamId: props.teamId, userId });
	};

	return (
		<div class="space-y-6">
			<div class="flex justify-end">
				<AddMemberSelector teamId={props.teamId} existingMemberIds={members().map((m) => m.id) ?? []} />
			</div>

			<Show when={members().length === 0}>
				<div class="flex flex-col items-center justify-center py-12 border border-dashed border-border rounded-lg">
					<div class="relative mb-4">
						<div class="absolute inset-0 bg-blue-400/20 rounded-full blur-xl animate-pulse" />
						<div class="relative p-3 rounded-full bg-gradient-to-br from-blue-100 to-blue-50 border border-blue-200/60">
							<UsersIcon class="w-8 h-8 text-blue-600" />
						</div>
					</div>
					<h3 class="text-lg font-medium text-foreground mb-1">No members yet</h3>
					<p class="text-sm text-muted-foreground text-center max-w-sm">Add users to this team to assign them to rotations.</p>
				</div>
			</Show>

			<div class="space-y-3">
				<For each={members()}>
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

// --- Add Member Selector ---

function AddMemberSelector(props: { teamId: string; existingMemberIds: string[] }) {
	const [open, setOpen] = createSignal(false);
	const addTeamMemberMutation = useAddTeamMember();
	const usersQuery = useUsers();
	const users = createMemo(
		() =>
			usersQuery.data
				?.filter((u) => !props.existingMemberIds.includes(u.id))
				.map((user) => ({
					id: user.id,
					name: user.name,
					avatar: user.image,
				})) ?? [],
	);

	const handleAdd = async (userId: string) => {
		addTeamMemberMutation.mutate({ teamId: props.teamId, userId });
		setOpen(false);
	};

	return (
		<Popover open={open()} onOpenChange={setOpen}>
			<PopoverTrigger as={Button}>
				<Plus class="w-4 h-4 mr-2" />
				Add Member
			</PopoverTrigger>
			<PopoverContent class="p-0" style={{ width: "200px" }}>
				<EntityPicker onSelect={(entity) => handleAdd(entity.id)} entities={users} placeholder="Select a user" />
			</PopoverContent>
		</Popover>
	);
}

// --- Rotations Tab ---

function TeamRotations(props: { teamId: string }) {
	const rotationsQuery = useRotations();
	const teamRotations = () => rotationsQuery.data?.filter((r) => r.teamId === props.teamId) ?? [];

	const [expandedId, setExpandedId] = createSignal<string | null>(null);
	const [isCreating, setIsCreating] = createSignal(false);
	const deleteMutation = useDeleteRotation();
	const createMutation = useCreateRotation({
		onMutate: (tempId) => {
			setIsCreating(false);
			setExpandedId(tempId);
		},
		onSuccess: (realId) => {
			setExpandedId(realId);
		},
	});

	const handleDelete = (id: string) => {
		if (expandedId() === id) {
			setExpandedId(null);
		}
		deleteMutation.mutate(id);
	};

	const toggleExpanded = (id: string) => {
		setExpandedId((current) => (current === id ? null : id));
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
						<RotationCard
							rotation={rotation()}
							isExpanded={expandedId() === rotation().id}
							onToggle={() => toggleExpanded(rotation().id)}
							onDelete={() => handleDelete(rotation().id)}
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

// --- Entry Points Tab ---

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
					rotations={rotationsQuery.data?.filter((r) => r.teamId === props.teamId) ?? []}
					onCancel={() => setIsCreating(false)}
					onSubmit={async (rotationId) => {
						const { id } = await handleCreate(rotationId);
						handleCreateSuccess(id);
					}}
					isSubmitting={createMutation.isPending}
				/>
			</Show>

			<Show when={entryPoints().length > 0} fallback={!isCreating() && <EntryPointsEmptyState />}>
				<div class="space-y-3">
					<For each={entryPoints()}>
						{(ep) => (
							<EntryPointCard
								entryPoint={ep}
								onDelete={() => handleDeleteWithCollapse(ep.id)}
								isExpanded={expandedId() === ep.id}
								onToggle={() => setExpandedId(expandedId() === ep.id ? null : ep.id)}
							/>
						)}
					</For>
				</div>
			</Show>
		</div>
	);
}

function CreateTeamEntryPointForm(props: {
	rotations: { id: string; name: string; shiftLength: string }[];
	onCancel: () => void;
	onSubmit: (rotationId: string) => void;
	isSubmitting: boolean;
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
								<Link to="/teams/$teamId" search={{ tab: "rotations" }} params={(prev) => ({ teamId: prev!.teamId! })} class="text-blue-600 hover:text-blue-700">
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
					<Button type="submit" disabled={!selectedRotationId() || props.isSubmitting}>
						<Show when={props.isSubmitting} fallback={<Plus class="w-4 h-4" />}>
							<LoaderCircle class="w-4 h-4 animate-spin" />
						</Show>
						Create
					</Button>
				</div>
			</form>
		</div>
	);
}

// --- Skeletons ---

function TeamHeaderSkeleton() {
	return (
		<div class="flex items-center gap-4">
			<Skeleton class="h-16 w-16 rounded-xl" />
			<div class="space-y-2">
				<Skeleton class="h-8 w-48" />
				<Skeleton class="h-4 w-32" />
			</div>
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
