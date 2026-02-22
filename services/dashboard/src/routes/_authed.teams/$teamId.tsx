import { createFileRoute, Link, Outlet, redirect, useLocation } from "@tanstack/solid-router";
import { Check, LoaderCircle, Pencil, Users as UsersIcon } from "lucide-solid";
import { createMemo, createSignal, ErrorBoundary, Show, Suspense } from "solid-js";
import { ImageUploadPicker } from "~/components/ImageUploadPicker";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Skeleton } from "~/components/ui/skeleton";
import { Tabs, TabsIndicator, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { requireRoutePermission } from "~/lib/auth/route-guards";
import { useTeams, useUpdateTeam } from "~/lib/teams/teams.hooks";
import { useUploadImage } from "~/lib/uploads/uploads.hooks";
import { cn } from "~/lib/utils/client";

export const Route = createFileRoute("/_authed/teams/$teamId")({
	component: TeamDetailsLayout,
	beforeLoad: ({ location, params }) => {
		requireRoutePermission("catalog.read")({ location });
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
		if (path.includes("/services")) return "services";
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
							<Link to="/teams/$teamId/services" params={{ teamId: params().teamId }}>
								<TabsTrigger value="services">Services</TabsTrigger>
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
	const uploadImageMutation = useUploadImage("team");

	const handleUpdateName = async () => {
		updateTeamMutation.mutate({ id: props.team.id, name: name() });
	};

	const handleUpdateImage = async () => {
		const file = imageFile();
		const url = droppedImageUrl().trim();
		let uploadedUrl = props.team.imageUrl || "";

		if (file || url) {
			try {
				const { imageUrl } = await uploadImageMutation.mutateAsync({ file, url });
				uploadedUrl = imageUrl;
			} catch {
				return;
			}
		}

		setImageFile(null);
		setDroppedImageUrl("");
		updateTeamMutation.mutate({ id: props.team.id, imageUrl: uploadedUrl || null });
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
						<ImageUploadPicker
							description="Choose or drop a file to replace the team icon."
							previewClass="h-16 w-16 overflow-hidden rounded-xl border border-blue-200 bg-gradient-to-br from-blue-100 to-blue-50 shadow-sm"
							imageFile={imageFile}
							setImageFile={setImageFile}
							droppedImageUrl={droppedImageUrl}
							setDroppedImageUrl={setDroppedImageUrl}
							previewFallback={props.team.imageUrl}
							inputId="team-image-file"
						/>
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
								disabled={isSubmitting() || uploadImageMutation.isPending || (!imageFile() && !droppedImageUrl())}
							>
								{isSubmitting() || uploadImageMutation.isPending ? <LoaderCircle class="w-4 h-4 animate-spin" /> : "Save"}
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
