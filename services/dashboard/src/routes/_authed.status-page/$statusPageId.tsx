import { createFileRoute } from "@tanstack/solid-router";
import { Activity, Check, ExternalLink, Flame, Globe, GripVertical, ImageUp, LoaderCircle, Pencil, Plus, Server, X } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Show, Suspense } from "solid-js";
import { EntityPicker } from "~/components/EntityPicker";
import { ImageUploadPicker } from "~/components/ImageUploadPicker";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { ConfigCard, ConfigCardRow } from "~/components/ui/config-card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { Skeleton } from "~/components/ui/skeleton";
import { useClient } from "~/lib/client/client.hooks";
import { useServices } from "~/lib/services/services.hooks";
import { useStatusPages, useUpdateStatusPage, useUpdateStatusPageServices } from "~/lib/status-pages/status-pages.hooks";
import { useUploadImage } from "~/lib/uploads/uploads.hooks";
import { cn } from "~/lib/utils/client";

export const Route = createFileRoute("/_authed/status-page/$statusPageId")({
	component: StatusPageDetailsPage,
});

type StatusPageData = NonNullable<ReturnType<typeof useStatusPages>["data"]>[number];
type StatusPageService = StatusPageData["services"][number];

function toSlug(value: string) {
	return value
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function StatusPageDetailsPage() {
	const params = Route.useParams();
	const statusPageId = createMemo(() => params().statusPageId);
	const statusPagesQuery = useStatusPages();
	const statusPage = createMemo(() => statusPagesQuery.data?.find((page) => page.id === statusPageId()));

	return (
		<div class="flex-1 bg-background py-8 px-8 md:py-12 md:px-12">
			<div class="max-w-4xl mx-auto">
				<Suspense fallback={<StatusPageDetailsSkeleton />}>
					<Show when={statusPage()} fallback={<StatusPageNotFound />}>
						{(data) => <StatusPageEditor page={data()} />}
					</Show>
				</Suspense>
			</div>
		</div>
	);
}

function StatusPageEditor(props: { page: StatusPageData }) {
	return (
		<div class="space-y-4">
			<div class="flex items-center justify-between">
				<h1 class="text-lg font-semibold text-foreground">Edit Status Page</h1>
				<Button as="a" href={`/status/${props.page.slug}`} target="_blank" rel="noreferrer" variant="outline" size="sm" class="gap-2">
					<ExternalLink class="w-4 h-4" />
					View live
				</Button>
			</div>
			<BrowserFrame page={props.page} />
		</div>
	);
}

// --- Browser Frame ---

function BrowserFrame(props: { page: StatusPageData }) {
	return (
		<div class="rounded-xl border border-border overflow-hidden shadow-lg bg-white">
			<BrowserChrome page={props.page} />
			<div class="py-8 px-12 md:py-12 md:px-24 space-y-8 bg-gradient-to-b from-slate-50 to-white min-h-[500px]">
				<div class="flex items-center justify-between">
					<EditableLogo page={props.page} />
					<Button variant="outline" size="sm" class="pointer-events-none">
						Subscribe to updates
					</Button>
				</div>
				<StatusBanner />
				<ServicesList statusPageId={props.page.id} services={props.page.services} />
				<Footer page={props.page} />
			</div>
		</div>
	);
}

// --- Browser Chrome ---

function BrowserChrome(props: { page: StatusPageData }) {
	const updateStatusPageMutation = useUpdateStatusPage();
	const uploadImageMutation = useUploadImage("status-page");
	const [isEditingSlug, setIsEditingSlug] = createSignal(false);
	const [isEditingFavicon, setIsEditingFavicon] = createSignal(false);
	const [slug, setSlug] = createSignal(props.page.slug);
	const [slugError, setSlugError] = createSignal<string | null>(null);
	const [faviconFile, setFaviconFile] = createSignal<File | null>(null);
	const [droppedFaviconUrl, setDroppedFaviconUrl] = createSignal("");
	const [faviconValidationError, setFaviconValidationError] = createSignal<string | null>(null);

	createEffect(() => {
		setSlug(props.page.slug);
		setSlugError(null);
	});

	const normalizedSlug = createMemo(() => toSlug(slug()));
	const hasSlugChanges = createMemo(() => normalizedSlug() !== props.page.slug);

	const handleSaveSlug = async () => {
		const nextSlug = normalizedSlug();
		if (!nextSlug) {
			setSlugError("Slug is required");
			return;
		}
		setSlugError(null);
		try {
			await updateStatusPageMutation.mutateAsync({ id: props.page.id, slug: nextSlug });
			setSlug(nextSlug);
			setIsEditingSlug(false);
		} catch (err) {
			setSlugError(err instanceof Error ? err.message : "Unable to update slug");
		}
	};

	const handleSaveFavicon = async () => {
		const file = faviconFile();
		const url = droppedFaviconUrl().trim();
		let uploadedUrl = props.page.faviconUrl || "";

		if (file || url) {
			try {
				const { imageUrl } = await uploadImageMutation.mutateAsync({ file, url });
				uploadedUrl = imageUrl;
			} catch {
				return;
			}
		}

		setFaviconFile(null);
		setDroppedFaviconUrl("");
		setIsEditingFavicon(false);
		updateStatusPageMutation.mutate({ id: props.page.id, faviconUrl: uploadedUrl || null });
	};

	return (
		<>
			<div class="flex items-center gap-3 px-4 py-3 bg-slate-100 border-b border-border">
				<div class="flex items-center gap-1.5">
					<div class="w-3 h-3 rounded-full bg-red-400" />
					<div class="w-3 h-3 rounded-full bg-yellow-400" />
					<div class="w-3 h-3 rounded-full bg-green-400" />
				</div>
				<div class="flex-1 flex items-center gap-2">
					<Show
						when={isEditingSlug()}
						fallback={
							<div class="flex-1 flex items-center bg-white rounded-md border border-border text-sm">
								<button
									type="button"
									class="flex items-center justify-center w-8 h-8 border-r border-border hover:bg-muted/50 transition-colors cursor-pointer shrink-0"
									onClick={(e) => {
										e.stopPropagation();
										setIsEditingFavicon(true);
									}}
								>
									<Show when={props.page.faviconUrl} fallback={<Flame class="w-4 h-4 text-orange-500" />}>
										{(url) => <img src={url()} alt="Favicon" class="w-4 h-4 object-contain" />}
									</Show>
								</button>
								<button type="button" class="flex-1 flex items-center px-2 py-1.5 cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => setIsEditingSlug(true)}>
									<span class="text-muted-foreground select-none">fire.app/status/</span>
									<span class="text-foreground font-medium">{props.page.slug}</span>
								</button>
							</div>
						}
					>
						<div class="flex-1 flex items-center bg-white rounded-md border border-blue-300 text-sm">
							<button
								type="button"
								class="flex items-center justify-center w-8 h-8 border-r border-border hover:bg-muted/50 transition-colors cursor-pointer shrink-0"
								onClick={(e) => {
									e.stopPropagation();
									setIsEditingFavicon(true);
								}}
							>
								<Show when={props.page.faviconUrl} fallback={<Flame class="w-4 h-4 text-orange-500" />}>
									{(url) => <img src={url()} alt="Favicon" class="w-4 h-4 object-contain" />}
								</Show>
							</button>
							<span class="text-muted-foreground select-none pl-2">fire.app/status/</span>
							<form
								class="flex items-center gap-1 flex-1 pr-2"
								onSubmit={(e) => {
									e.preventDefault();
									handleSaveSlug();
								}}
								onKeyDown={(e) => {
									if (e.key === "Escape") {
										setIsEditingSlug(false);
										setSlug(props.page.slug);
									}
								}}
							>
								<input
									type="text"
									value={slug()}
									onInput={(e) => setSlug(e.currentTarget.value)}
									class="flex-1 min-w-0 px-1 py-0.5 text-sm border-none focus:outline-none bg-transparent"
									autofocus
								/>
								<button type="submit" class="p-1 text-green-600 hover:text-green-700 cursor-pointer" disabled={updateStatusPageMutation.isPending || !hasSlugChanges()}>
									<Show when={updateStatusPageMutation.isPending} fallback={<Check class="w-4 h-4" />}>
										<LoaderCircle class="w-4 h-4 animate-spin" />
									</Show>
								</button>
								<button type="button" class="p-1 text-muted-foreground hover:text-foreground cursor-pointer" onClick={() => setIsEditingSlug(false)}>
									<X class="w-4 h-4" />
								</button>
							</form>
						</div>
					</Show>
					<div class="flex items-center gap-1.5 shrink-0 text-sm text-muted-foreground/60">
						<Globe class="w-4 h-4" />
						<span class="hidden sm:inline">Custom domain</span>
						<span class="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full font-medium">Soon</span>
					</div>
				</div>
			</div>
			<Show when={slugError()}>
				<div class="px-4 py-2 bg-red-50 border-b border-red-200">
					<p class="text-xs text-red-600">{slugError()}</p>
				</div>
			</Show>

			<Dialog open={isEditingFavicon()} onOpenChange={setIsEditingFavicon}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Update Favicon</DialogTitle>
						<DialogDescription>Choose a favicon for your status page browser tab.</DialogDescription>
					</DialogHeader>
					<ImageUploadPicker
						description="Choose or drop a small square image (recommended 32x32 or 64x64)."
						previewClass="h-8 w-8 overflow-hidden rounded border border-slate-200 bg-white shadow-sm"
						imageFile={faviconFile}
						setImageFile={setFaviconFile}
						droppedImageUrl={droppedFaviconUrl}
						setDroppedImageUrl={setDroppedFaviconUrl}
						previewFallback={props.page.faviconUrl}
						inputId="status-page-favicon-file"
						maxSizeBytes={512 * 1024}
						onValidationError={setFaviconValidationError}
					/>
					<DialogFooter>
						<Button variant="outline" onClick={() => setIsEditingFavicon(false)}>
							Cancel
						</Button>
						<Button onClick={handleSaveFavicon} disabled={uploadImageMutation.isPending || updateStatusPageMutation.isPending || !!faviconValidationError()}>
							<Show when={uploadImageMutation.isPending || updateStatusPageMutation.isPending} fallback="Save">
								<LoaderCircle class="w-4 h-4 animate-spin mr-2" />
								Saving...
							</Show>
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

// --- Editable Logo ---

function EditableLogo(props: { page: StatusPageData }) {
	const clientQuery = useClient();
	const updateStatusPageMutation = useUpdateStatusPage();
	const uploadImageMutation = useUploadImage("status-page");

	const [isEditingLogo, setIsEditingLogo] = createSignal(false);
	const [imageFile, setImageFile] = createSignal<File | null>(null);
	const [droppedImageUrl, setDroppedImageUrl] = createSignal("");
	const [logoValidationError, setLogoValidationError] = createSignal<string | null>(null);

	const displayLogo = createMemo(() => props.page.logoUrl || clientQuery.data?.image || null);

	const handleSaveLogo = async () => {
		const file = imageFile();
		const url = droppedImageUrl().trim();
		let uploadedUrl = props.page.logoUrl || "";

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
		setIsEditingLogo(false);
		updateStatusPageMutation.mutate({ id: props.page.id, logoUrl: uploadedUrl || null });
	};

	return (
		<>
			<button
				type="button"
				class={cn("relative group cursor-pointer bg-transparent border-none p-0", "rounded-xl overflow-hidden", "ring-2 ring-transparent hover:ring-blue-300 transition-all")}
				onClick={() => setIsEditingLogo(true)}
			>
				<Show
					when={displayLogo()}
					fallback={
						<div class="w-14 h-14 rounded-xl bg-gradient-to-br from-slate-100 to-slate-50 border border-slate-200 flex items-center justify-center text-slate-400">
							<ImageUp class="w-6 h-6" />
						</div>
					}
				>
					{(logoUrl) => <img src={logoUrl()} alt="Status page logo" class="w-14 h-14 object-contain" />}
				</Show>
				<div class="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-xl">
					<Pencil class="w-4 h-4 text-white" />
				</div>
			</button>

			<Dialog open={isEditingLogo()} onOpenChange={setIsEditingLogo}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Update Logo</DialogTitle>
						<DialogDescription>Choose a logo for your status page. Falls back to your workspace logo if not set.</DialogDescription>
					</DialogHeader>
					<ImageUploadPicker
						description="Choose or drop a file to replace the logo."
						previewClass="h-20 w-20 overflow-hidden rounded-xl border border-slate-200 bg-gradient-to-br from-slate-100 to-slate-50 shadow-sm"
						imageFile={imageFile}
						setImageFile={setImageFile}
						droppedImageUrl={droppedImageUrl}
						setDroppedImageUrl={setDroppedImageUrl}
						previewFallback={displayLogo()}
						inputId="status-page-logo-file"
						onValidationError={setLogoValidationError}
					/>
					<DialogFooter>
						<Button variant="outline" onClick={() => setIsEditingLogo(false)}>
							Cancel
						</Button>
						<Button onClick={handleSaveLogo} disabled={uploadImageMutation.isPending || updateStatusPageMutation.isPending || !!logoValidationError()}>
							<Show when={uploadImageMutation.isPending || updateStatusPageMutation.isPending} fallback="Save">
								<LoaderCircle class="w-4 h-4 animate-spin mr-2" />
								Saving...
							</Show>
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

// --- Status Banner ---

function StatusBanner() {
	return (
		<div class="rounded-lg bg-emerald-50 border border-emerald-200 p-4">
			<div class="flex items-center justify-center gap-2">
				<div class="w-2.5 h-2.5 rounded-full bg-emerald-500" />
				<span class="text-emerald-700 font-medium">All systems operational</span>
			</div>
		</div>
	);
}

// --- Services List ---

function ServicesList(props: { statusPageId: string; services: StatusPageService[] }) {
	const servicesQuery = useServices();
	const updateServicesMutation = useUpdateStatusPageServices();

	const [draggedId, setDraggedId] = createSignal<string | null>(null);
	const [dropTargetIndex, setDropTargetIndex] = createSignal<number | null>(null);

	const availableServices = createMemo(() => servicesQuery.data?.filter((service) => !props.services.some((selected) => selected.id === service.id)) ?? []);
	const availableEntities = createMemo(() =>
		availableServices().map((service) => ({ id: service.id, name: service.name?.trim() || "Untitled service", avatar: service.imageUrl })),
	);

	const updateServices = (serviceIds: string[]) => {
		updateServicesMutation.mutate({ id: props.statusPageId, serviceIds });
	};

	const handleAddService = (service: { id: string }) => {
		updateServices([...props.services.map((item) => item.id), service.id]);
	};

	const handleRemoveService = (serviceId: string) => {
		updateServices(props.services.filter((item) => item.id !== serviceId).map((item) => item.id));
	};

	const handleDragStart = (serviceId: string) => {
		setDraggedId(serviceId);
	};

	const handleDragEnd = () => {
		const draggedServiceId = draggedId();
		const targetIndex = dropTargetIndex();

		if (draggedServiceId && targetIndex !== null) {
			const currentIndex = props.services.findIndex((service) => service.id === draggedServiceId);
			if (currentIndex !== -1 && currentIndex !== targetIndex) {
				const reordered = props.services.map((service) => service.id);
				const [moved] = reordered.splice(currentIndex, 1);
				const insertAt = Math.max(0, Math.min(targetIndex, reordered.length));
				reordered.splice(insertAt, 0, moved);
				updateServices(reordered);
			}
		}

		setDraggedId(null);
		setDropTargetIndex(null);
	};

	const handleDragOver = (index: number) => {
		if (draggedId()) {
			setDropTargetIndex(index);
		}
	};

	return (
		<div class="space-y-3">
			<div class="flex items-center justify-end">
				<Popover>
					<PopoverTrigger as={Button} size="sm" variant="outline" disabled={availableEntities().length === 0 || updateServicesMutation.isPending}>
						<Plus class="w-4 h-4 mr-1" />
						Add service
					</PopoverTrigger>
					<PopoverContent class="p-0" style={{ width: "240px" }}>
						<EntityPicker onSelect={handleAddService} entities={availableEntities} placeholder="Select a service" emptyMessage="No services to add." />
					</PopoverContent>
				</Popover>
			</div>

			<Show when={props.services.length > 0} fallback={<ServicesEmptyState />}>
				<div class="space-y-2">
					<For each={props.services}>
						{(service, index) => (
							// biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop container needs these handlers
							<div
								draggable={!updateServicesMutation.isPending}
								onDragStart={(e) => {
									e.dataTransfer?.setData("text/plain", service.id);
									handleDragStart(service.id);
								}}
								onDragEnd={handleDragEnd}
								onDragOver={(e) => {
									e.preventDefault();
									handleDragOver(index());
								}}
								onDrop={(e) => {
									e.preventDefault();
								}}
								classList={{
									"opacity-50 scale-95": draggedId() === service.id,
									"ring-2 ring-blue-400 ring-offset-1": dropTargetIndex() === index() && draggedId() !== service.id,
								}}
							>
								<ConfigCard class="bg-white hover:bg-muted/30 transition-colors">
									<ConfigCardRow class="py-3">
										<div class="flex items-center gap-3 flex-1 min-w-0">
											<GripVertical class="w-4 h-4 text-muted-foreground cursor-grab" />
											<Show when={service.imageUrl} fallback={<Server class="w-5 h-5 text-emerald-600" />}>
												{(imageUrl) => <img src={imageUrl()} alt={service.name ?? ""} class="w-6 h-6 rounded object-cover shrink-0" />}
											</Show>
											<p class="text-sm font-medium text-foreground truncate min-w-0 flex-1">{service.name?.trim() || "Untitled service"}</p>
											<div class="flex items-center gap-1">
												<div class="w-2 h-2 rounded-full bg-emerald-500" />
												<span class="text-xs text-emerald-600">Operational</span>
											</div>
										</div>
										<Button
											variant="ghost"
											size="icon"
											class="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
											onClick={() => handleRemoveService(service.id)}
											disabled={updateServicesMutation.isPending}
										>
											<Show when={updateServicesMutation.isPending} fallback={<X class="w-4 h-4" />}>
												<LoaderCircle class="w-4 h-4 animate-spin" />
											</Show>
										</Button>
									</ConfigCardRow>
								</ConfigCard>
							</div>
						)}
					</For>
				</div>
			</Show>
		</div>
	);
}

function ServicesEmptyState() {
	return (
		<div class="rounded-lg border border-dashed border-border p-6 text-center">
			<Server class="w-8 h-8 text-muted-foreground mx-auto mb-2" />
			<p class="text-sm text-muted-foreground">No services added yet</p>
			<p class="text-xs text-muted-foreground mt-1">Add services to display on your status page</p>
		</div>
	);
}

// --- Footer ---

function Footer(props: { page: StatusPageData }) {
	const updateStatusPageMutation = useUpdateStatusPage();

	const [isEditingPrivacy, setIsEditingPrivacy] = createSignal(false);
	const [isEditingTerms, setIsEditingTerms] = createSignal(false);
	const [privacyUrl, setPrivacyUrl] = createSignal(props.page.privacyPolicyUrl ?? "");
	const [termsUrl, setTermsUrl] = createSignal(props.page.termsOfServiceUrl ?? "");

	createEffect(() => {
		setPrivacyUrl(props.page.privacyPolicyUrl ?? "");
		setTermsUrl(props.page.termsOfServiceUrl ?? "");
	});

	const handleSavePrivacy = async () => {
		await updateStatusPageMutation.mutateAsync({ id: props.page.id, privacyPolicyUrl: privacyUrl().trim() || null });
		setIsEditingPrivacy(false);
	};

	const handleSaveTerms = async () => {
		await updateStatusPageMutation.mutateAsync({ id: props.page.id, termsOfServiceUrl: termsUrl().trim() || null });
		setIsEditingTerms(false);
	};

	return (
		<div class="pt-8 space-y-3">
			<div class="flex items-center justify-between text-xs text-muted-foreground">
				<span class="flex items-center gap-1.5">&larr; Incident History</span>
				<span class="flex items-center gap-1.5">
					Powered by <Flame class="w-3.5 h-3.5 text-orange-500" />
				</span>
			</div>
			<div class="flex items-center justify-center gap-1 text-[10px] text-muted-foreground/50">
				<EditableFooterLink
					label="Privacy Policy"
					url={props.page.privacyPolicyUrl}
					isEditing={isEditingPrivacy()}
					setIsEditing={setIsEditingPrivacy}
					value={privacyUrl()}
					setValue={setPrivacyUrl}
					onSave={handleSavePrivacy}
					isPending={updateStatusPageMutation.isPending}
				/>
				<span>&middot;</span>
				<EditableFooterLink
					label="Terms of Service"
					url={props.page.termsOfServiceUrl}
					isEditing={isEditingTerms()}
					setIsEditing={setIsEditingTerms}
					value={termsUrl()}
					setValue={setTermsUrl}
					onSave={handleSaveTerms}
					isPending={updateStatusPageMutation.isPending}
				/>
			</div>
		</div>
	);
}

function EditableFooterLink(props: {
	label: string;
	url: string | null;
	isEditing: boolean;
	setIsEditing: (editing: boolean) => void;
	value: string;
	setValue: (value: string) => void;
	onSave: () => void;
	isPending: boolean;
}) {
	return (
		<Show
			when={props.isEditing}
			fallback={
				<button
					type="button"
					class={cn("hover:text-muted-foreground cursor-pointer bg-transparent border-none p-0 transition-colors", "hover:underline", !props.url && "italic")}
					onClick={() => props.setIsEditing(true)}
				>
					{props.url ? props.label : `+ ${props.label}`}
				</button>
			}
		>
			<form
				class="flex items-center gap-0.5"
				onSubmit={(e) => {
					e.preventDefault();
					props.onSave();
				}}
				onKeyDown={(e) => {
					if (e.key === "Escape") {
						props.setIsEditing(false);
					}
				}}
			>
				<input
					type="url"
					placeholder="https://..."
					value={props.value}
					onInput={(e) => props.setValue(e.currentTarget.value)}
					class="w-32 px-1.5 py-0.5 text-[10px] border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
					autofocus
				/>
				<button type="submit" class="p-0.5 text-green-600 hover:text-green-700 cursor-pointer" disabled={props.isPending}>
					<Show when={props.isPending} fallback={<Check class="w-2.5 h-2.5" />}>
						<LoaderCircle class="w-2.5 h-2.5 animate-spin" />
					</Show>
				</button>
				<button type="button" class="p-0.5 text-muted-foreground hover:text-foreground cursor-pointer" onClick={() => props.setIsEditing(false)}>
					<X class="w-2.5 h-2.5" />
				</button>
			</form>
		</Show>
	);
}

// --- Not Found ---

function StatusPageNotFound() {
	return (
		<Card class="p-6">
			<div class="flex flex-col items-center justify-center py-12">
				<div class="relative mb-4">
					<div class="absolute inset-0 bg-slate-400/20 rounded-full blur-xl animate-pulse" />
					<div class="relative p-3 rounded-full bg-gradient-to-br from-slate-100 to-slate-50 border border-slate-200/60">
						<Activity class="w-8 h-8 text-slate-600" />
					</div>
				</div>
				<h3 class="text-lg font-medium text-foreground mb-1">Status page not found</h3>
				<p class="text-sm text-muted-foreground">The status page you are looking for does not exist.</p>
			</div>
		</Card>
	);
}

// --- Skeleton ---

function StatusPageDetailsSkeleton() {
	return (
		<div class="space-y-4">
			<div class="flex items-center justify-between">
				<Skeleton class="h-7 w-40" />
				<Skeleton class="h-9 w-24" />
			</div>
			<div class="rounded-xl border border-border overflow-hidden shadow-lg">
				<Skeleton class="h-12 w-full" />
				<div class="p-6 md:p-8 space-y-8">
					<div class="flex justify-center">
						<Skeleton class="h-20 w-20 rounded-xl" />
					</div>
					<Skeleton class="h-14 w-full rounded-lg" />
					<div class="space-y-3">
						<div class="flex justify-between">
							<Skeleton class="h-5 w-20" />
							<Skeleton class="h-8 w-16" />
						</div>
						<Skeleton class="h-14 w-full" />
						<Skeleton class="h-14 w-full" />
					</div>
				</div>
			</div>
		</div>
	);
}
