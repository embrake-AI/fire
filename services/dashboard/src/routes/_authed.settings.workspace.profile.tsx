import { createFileRoute } from "@tanstack/solid-router";
import { Building2, LoaderCircle, Pencil } from "lucide-solid";
import { createEffect, createSignal, onCleanup, Show, Suspense } from "solid-js";
import { ImageUploadPicker } from "~/components/ImageUploadPicker";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Skeleton } from "~/components/ui/skeleton";
import { useClient, useUpdateClient } from "~/lib/client/client.hooks";
import { useUploadImage } from "~/lib/uploads/uploads.hooks";

export const Route = createFileRoute("/_authed/settings/workspace/profile")({
	component: WorkspaceProfilePage,
});

function WorkspaceProfilePage() {
	return (
		<div class="space-y-4">
			<div class="text-center">
				<h2 class="text-lg font-semibold text-foreground">Workspace Profile</h2>
			</div>

			<Suspense fallback={<ProfileSkeleton />}>
				<ProfileContent />
			</Suspense>
		</div>
	);
}

function ProfileSkeleton() {
	return (
		<div class="max-w-xl mx-auto rounded-xl bg-muted/20 px-4 py-2">
			<div class="divide-y divide-border/40">
				<div class="grid gap-3 py-3 sm:grid-cols-[160px_1fr] sm:items-center sm:gap-6">
					<div class="space-y-2">
						<Skeleton class="h-4 w-24" />
					</div>
					<Skeleton class="h-10 w-10 rounded-xl justify-self-end" />
				</div>
				<div class="grid gap-3 py-3 sm:grid-cols-[160px_1fr] sm:items-center sm:gap-6">
					<div class="space-y-2">
						<Skeleton class="h-4 w-28" />
					</div>
					<Skeleton class="h-8 w-48 rounded-md justify-self-end" />
				</div>
				<div class="grid gap-3 py-3 sm:grid-cols-[160px_1fr] sm:items-center sm:gap-6">
					<div class="space-y-2">
						<Skeleton class="h-4 w-20" />
					</div>
					<Skeleton class="h-4 w-40 justify-self-end" />
				</div>
			</div>
		</div>
	);
}

function ProfileContent() {
	const clientQuery = useClient();
	const updateClientMutation = useUpdateClient();

	const [isEditingImage, setIsEditingImage] = createSignal(false);
	const [name, setName] = createSignal("");
	const [lastSavedName, setLastSavedName] = createSignal("");
	const [imageFile, setImageFile] = createSignal<File | null>(null);
	const [droppedImageUrl, setDroppedImageUrl] = createSignal("");
	const uploadImageMutation = useUploadImage("client");
	let saveTimeout: ReturnType<typeof setTimeout> | undefined;

	createEffect(() => {
		if (clientQuery.data?.name) {
			setName(clientQuery.data.name);
			setLastSavedName(clientQuery.data.name);
		}
	});

	const saveName = (value: string) => {
		const trimmed = value.trim();
		if (!trimmed || trimmed === lastSavedName()) {
			return;
		}
		setLastSavedName(trimmed);
		updateClientMutation.mutate({ name: trimmed });
	};

	const scheduleSave = (value: string) => {
		if (saveTimeout) {
			clearTimeout(saveTimeout);
		}
		saveTimeout = setTimeout(() => saveName(value), 600);
	};

	onCleanup(() => {
		if (saveTimeout) {
			clearTimeout(saveTimeout);
		}
	});

	const handleUpdateImage = async () => {
		const file = imageFile();
		const url = droppedImageUrl().trim();

		if (file || url) {
			try {
				const { imageUrl } = await uploadImageMutation.mutateAsync({ file, url });
				updateClientMutation.mutate({ image: imageUrl });
			} catch {
				return;
			}
		}

		setImageFile(null);
		setDroppedImageUrl("");
		setIsEditingImage(false);
	};

	return (
		<div class="max-w-xl mx-auto rounded-xl bg-muted/20 px-4 py-2">
			<div class="divide-y divide-border/40">
				<div class="grid gap-3 py-3 sm:grid-cols-[160px_1fr] sm:items-center sm:gap-6">
					<p class="text-sm font-medium text-foreground">Workspace image</p>
					<button
						type="button"
						class="relative h-10 w-10 rounded-xl overflow-hidden cursor-pointer flex-shrink-0 bg-gradient-to-br from-blue-100 to-blue-50 flex items-center justify-center justify-self-end"
						onClick={() => setIsEditingImage(true)}
					>
						<Show when={clientQuery.data?.image} fallback={<Building2 class="h-6 w-6 text-blue-600" />}>
							{(imageUrl) => <img src={imageUrl()} alt={clientQuery.data?.name} class="h-full w-full object-cover" />}
						</Show>
						<div class="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
							<Pencil class="w-4 h-4 text-white" />
						</div>
					</button>
				</div>

				<div class="grid gap-3 py-3 sm:grid-cols-[160px_1fr] sm:items-center sm:gap-6">
					<p class="text-sm font-medium text-foreground">Name</p>
					<div class="sm:justify-self-end">
						<Input
							id="workspace-profile-name"
							value={name()}
							onInput={(e) => {
								const next = e.currentTarget.value;
								setName(next);
								scheduleSave(next);
							}}
							onBlur={() => saveName(name())}
							disabled={updateClientMutation.isPending}
							class="h-8 w-56 text-left"
						/>
					</div>
				</div>

				<Show when={clientQuery.data?.domains && clientQuery.data.domains.length > 0}>
					<div class="grid gap-3 py-3 sm:grid-cols-[160px_1fr] sm:items-center sm:gap-6">
						<p class="text-sm font-medium text-foreground">Domains</p>
						<p class="text-sm font-medium text-foreground sm:justify-self-end text-right">{clientQuery.data?.domains?.join(", ")}</p>
					</div>
				</Show>
			</div>

			<Dialog open={isEditingImage()} onOpenChange={setIsEditingImage}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Update Workspace Logo</DialogTitle>
					</DialogHeader>
					<div class="space-y-4 py-4">
						<ImageUploadPicker
							description="Choose or drop a file to update your workspace logo."
							previewClass="h-20 w-20 overflow-hidden rounded-xl border-2 border-blue-200 shadow-sm"
							imageFile={imageFile}
							setImageFile={setImageFile}
							droppedImageUrl={droppedImageUrl}
							setDroppedImageUrl={setDroppedImageUrl}
							previewFallback={clientQuery.data?.image}
						/>
						<div class="flex justify-end gap-2">
							<Button variant="ghost" onClick={() => setIsEditingImage(false)}>
								Cancel
							</Button>
							<Button onClick={() => handleUpdateImage()} disabled={uploadImageMutation.isPending || (!imageFile() && !droppedImageUrl())}>
								{uploadImageMutation.isPending ? <LoaderCircle class="w-4 h-4 animate-spin" /> : "Save"}
							</Button>
						</div>
					</div>
				</DialogContent>
			</Dialog>
		</div>
	);
}
