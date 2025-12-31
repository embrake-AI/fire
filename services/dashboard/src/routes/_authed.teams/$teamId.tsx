import { createFileRoute, Link, Outlet, redirect, useLocation } from "@tanstack/solid-router";
import { Check, ImageUp, LoaderCircle, Pencil, Users as UsersIcon } from "lucide-solid";
import { createEffect, createMemo, createSignal, ErrorBoundary, onCleanup, Show, Suspense } from "solid-js";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Skeleton } from "~/components/ui/skeleton";
import { Tabs, TabsIndicator, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { useTeams, useUpdateTeam } from "~/lib/teams/teams.hooks";
import { cn } from "~/lib/utils/client";

export const Route = createFileRoute("/_authed/teams/$teamId")({
	component: TeamDetailsLayout,
	beforeLoad: ({ location, params }) => {
		const pathname = location.pathname.endsWith("/") ? location.pathname.slice(0, -1) : location.pathname;
		if (pathname === `/teams/${params.teamId}`) {
			throw redirect({ to: "/teams/$teamId/users", params });
		}
	},
});

function TeamDetailsLayout() {
	const params = Route.useParams();
	const location = useLocation();
	const teamsQuery = useTeams();

	const teamId = createMemo(() => params().teamId);
	const team = createMemo(() => {
		const id = teamId();
		return id ? teamsQuery.data?.find((t) => t.id === id) : undefined;
	});

	const activeTab = createMemo(() => {
		const path = location().pathname;
		if (path.includes("/entry-points")) return "entry-points";
		if (path.includes("/rotations")) return "rotations";
		return "users";
	});

	return (
		<ErrorBoundary
			fallback={(error) => (
				<div>
					Error {error.message} {error.stack}
				</div>
			)}
		>
			<div class="flex-1 bg-background p-6 md:p-8">
				<div class="max-w-5xl mx-auto space-y-8">
					<Suspense fallback={<TeamHeaderSkeleton />}>
						<Show when={team()} fallback={<div>Team not found</div>}>
							{(team) => <TeamHeader team={team()} />}
						</Show>
					</Suspense>

					<Tabs value={activeTab()}>
						<TabsList>
							<Link to="/teams/$teamId/users" params={{ teamId: params().teamId }}>
								<TabsTrigger value="users">Users</TabsTrigger>
							</Link>
							<Link to="/teams/$teamId/rotations" params={{ teamId: params().teamId }}>
								<TabsTrigger value="rotations">Rotations</TabsTrigger>
							</Link>
							<Link to="/teams/$teamId/entry-points" params={{ teamId: params().teamId }}>
								<TabsTrigger value="entry-points">Entry Points</TabsTrigger>
							</Link>
							<TabsIndicator />
						</TabsList>
					</Tabs>

					<div class="mt-6">
						<Outlet />
					</div>
				</div>
			</div>
		</ErrorBoundary>
	);
}

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
					<span>
						{props.team.memberCount} {props.team.memberCount === 1 ? "member" : "members"}
					</span>
				</p>
			</div>
		</div>
	);
}

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
