import { createFileRoute } from "@tanstack/solid-router";
import { LoaderCircle, Pencil } from "lucide-solid";
import { createEffect, createSignal, onCleanup, Show, Suspense } from "solid-js";
import { ImageUploadPicker } from "~/components/ImageUploadPicker";
import { UserAvatar } from "~/components/UserAvatar";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Skeleton } from "~/components/ui/skeleton";
import { useUploadImage } from "~/lib/uploads/uploads.hooks";
import { useCurrentUser, useUpdateUser } from "~/lib/users/users.hooks";

export const Route = createFileRoute("/_authed/settings/account/profile")({
	component: AccountProfilePage,
});

function AccountProfilePage() {
	return (
		<div class="space-y-4">
			<div class="text-center">
				<h2 class="text-lg font-semibold text-foreground">Profile</h2>
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
					<Skeleton class="h-10 w-10 rounded-full justify-self-end" />
				</div>
				<div class="grid gap-3 py-3 sm:grid-cols-[160px_1fr] sm:items-center sm:gap-6">
					<div class="space-y-2">
						<Skeleton class="h-4 w-20" />
					</div>
					<Skeleton class="h-8 w-40 rounded-md justify-self-end" />
				</div>
				<div class="grid gap-3 py-3 sm:grid-cols-[160px_1fr] sm:items-center sm:gap-6">
					<div class="space-y-2">
						<Skeleton class="h-4 w-16" />
					</div>
					<Skeleton class="h-4 w-40 justify-self-end" />
				</div>
			</div>
		</div>
	);
}

function ProfileContent() {
	const userQuery = useCurrentUser();
	const updateUserMutation = useUpdateUser();

	const [isEditingImage, setIsEditingImage] = createSignal(false);
	const [name, setName] = createSignal("");
	const [lastSavedName, setLastSavedName] = createSignal("");
	const [imageFile, setImageFile] = createSignal<File | null>(null);
	const [droppedImageUrl, setDroppedImageUrl] = createSignal("");
	const uploadImageMutation = useUploadImage("user");
	let saveTimeout: ReturnType<typeof setTimeout> | undefined;

	createEffect(() => {
		if (userQuery.data?.name) {
			setName(userQuery.data.name);
			setLastSavedName(userQuery.data.name);
		}
	});

	const saveName = (value: string) => {
		const trimmed = value.trim();
		if (!trimmed || trimmed === lastSavedName()) {
			return;
		}
		setLastSavedName(trimmed);
		updateUserMutation.mutate({ name: trimmed });
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
				updateUserMutation.mutate({ image: imageUrl });
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
					<p class="text-sm font-medium text-foreground">Profile picture</p>
					<button type="button" class="relative h-10 w-10 rounded-full overflow-hidden cursor-pointer flex-shrink-0 sm:justify-self-end" onClick={() => setIsEditingImage(true)}>
						<Show when={userQuery.data} fallback={<div class="h-full w-full bg-muted" />}>
							{(user) => (
								<div class="h-full w-full">
									<UserAvatar name={() => user().name} avatar={() => user().image} sizeClass="h-full w-full" />
								</div>
							)}
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
							value={name()}
							onInput={(e) => {
								const next = e.currentTarget.value;
								setName(next);
								scheduleSave(next);
							}}
							onBlur={() => saveName(name())}
							disabled={updateUserMutation.isPending}
							class="h-8 w-48 text-left"
						/>
					</div>
				</div>

				<div class="grid gap-3 py-3 sm:grid-cols-[160px_1fr] sm:items-center sm:gap-6">
					<p class="text-sm font-medium text-foreground">Email</p>
					<p class="text-sm font-medium text-foreground sm:justify-self-end text-right">{userQuery.data?.email}</p>
				</div>
			</div>

			<Dialog open={isEditingImage()} onOpenChange={setIsEditingImage}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Update Profile Picture</DialogTitle>
					</DialogHeader>
					<div class="space-y-4 py-4">
						<ImageUploadPicker
							description="Choose or drop a file to update your profile picture."
							previewClass="h-16 w-16 overflow-hidden rounded-full border border-border"
							imageFile={imageFile}
							setImageFile={setImageFile}
							droppedImageUrl={droppedImageUrl}
							setDroppedImageUrl={setDroppedImageUrl}
							previewFallback={userQuery.data?.image}
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
