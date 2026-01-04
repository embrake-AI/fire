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
		<div class="space-y-8">
			<div>
				<h2 class="text-lg font-semibold text-foreground">Profile</h2>
				<p class="text-sm text-muted-foreground mt-1">Manage your personal profile information</p>
			</div>

			<Suspense fallback={<ProfileSkeleton />}>
				<ProfileContent />
			</Suspense>
		</div>
	);
}

function ProfileSkeleton() {
	return (
		<div class="rounded-xl bg-muted/20 px-4 py-2">
			<div class="divide-y divide-border/40">
				<div class="flex items-center justify-between py-3">
					<Skeleton class="h-4 w-24" />
					<Skeleton class="h-10 w-10 rounded-full" />
				</div>
				<div class="flex items-center justify-between py-3">
					<Skeleton class="h-4 w-20" />
					<Skeleton class="h-8 w-48 rounded-md" />
				</div>
				<div class="flex items-center justify-between py-3">
					<Skeleton class="h-4 w-16" />
					<Skeleton class="h-4 w-40" />
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
		const serverName = userQuery.data?.name;
		if (serverName && !lastSavedName()) {
			setName(serverName);
			setLastSavedName(serverName);
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
		<div class="rounded-xl bg-muted/20 px-4 py-2">
			<div class="divide-y divide-border/40">
				<div class="flex items-center justify-between py-3">
					<p class="text-sm font-medium text-foreground">Profile picture</p>
					<button type="button" class="relative h-10 w-10 rounded-full overflow-hidden cursor-pointer flex-shrink-0" onClick={() => setIsEditingImage(true)}>
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

				<div class="flex items-center justify-between py-3">
					<p class="text-sm font-medium text-foreground">Name</p>
					<Input
						value={name()}
						onInput={(e) => {
							const next = e.currentTarget.value;
							setName(next);
							scheduleSave(next);
						}}
						onBlur={() => saveName(name())}
						class="h-8 w-64 text-left"
					/>
				</div>

				<div class="flex items-center justify-between py-3">
					<p class="text-sm font-medium text-foreground">Email</p>
					<p class="text-sm text-muted-foreground">{userQuery.data?.email}</p>
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
