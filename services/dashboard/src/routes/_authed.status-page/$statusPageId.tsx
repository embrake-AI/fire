import { createFileRoute } from "@tanstack/solid-router";
import {
	Activity,
	AlertTriangle,
	ArrowRight,
	Check,
	CheckCircle,
	ClipboardCopy,
	ExternalLink,
	Flame,
	Globe,
	GripVertical,
	ImageOff,
	ImageUp,
	LoaderCircle,
	Pencil,
	Plus,
	Server,
	X,
} from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Show, Suspense } from "solid-js";
import { EntityPicker } from "~/components/EntityPicker";
import { ImageUploadPicker } from "~/components/ImageUploadPicker";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { ConfigCard, ConfigCardRow } from "~/components/ui/config-card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { Skeleton } from "~/components/ui/skeleton";
import { useClient } from "~/lib/client/client.hooks";
import { useServices } from "~/lib/services/services.hooks";
import {
	useStatusPages,
	useUpdateStatusPage,
	useUpdateStatusPageServiceDescription,
	useUpdateStatusPageServices,
	useVerifyCustomDomain,
} from "~/lib/status-pages/status-pages.hooks";
import { isApexDomain, isValidDomain, normalizeDomain } from "~/lib/status-pages/status-pages.utils";
import { useUploadImage } from "~/lib/uploads/uploads.hooks";
import { cn } from "~/lib/utils/client";

export const Route = createFileRoute("/_authed/status-page/$statusPageId")({
	component: StatusPageDetailsPage,
});

type StatusPageData = NonNullable<ReturnType<typeof useStatusPages>["data"]>[number];

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
	return <BrowserFrame page={props.page} />;
}

// --- Browser Frame ---

function BrowserFrame(props: { page: StatusPageData }) {
	return (
		<div class="rounded-xl border border-border overflow-hidden shadow-lg bg-white">
			<BrowserChrome page={props.page} />
			<div class="py-8 px-12 md:py-12 md:px-24 space-y-8 bg-linear-to-b from-slate-50 to-white min-h-125">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-3">
						<EditableLogo page={props.page} />
						<EditableCompanyName page={props.page} />
					</div>
					<Button variant="outline" size="sm" class="pointer-events-none">
						Subscribe to updates
					</Button>
				</div>
				<StatusBanner />
				<SubscribeSettings page={props.page} />
				<ServicesList page={props.page} />
				<Footer page={props.page} />
			</div>
		</div>
	);
}

// --- Browser Chrome ---

type WizardStep = 1 | 2 | 3;

function BrowserChrome(props: { page: StatusPageData }) {
	const updateStatusPageMutation = useUpdateStatusPage();
	const uploadImageMutation = useUploadImage("status-page");
	const verifyDomainMutation = useVerifyCustomDomain();
	const [isEditingSlug, setIsEditingSlug] = createSignal(false);
	const [isEditingFavicon, setIsEditingFavicon] = createSignal(false);
	const [slug, setSlug] = createSignal(props.page.slug);
	const [slugError, setSlugError] = createSignal<string | null>(null);
	const [faviconFile, setFaviconFile] = createSignal<File | null>(null);
	const [droppedFaviconUrl, setDroppedFaviconUrl] = createSignal("");
	const [faviconValidationError, setFaviconValidationError] = createSignal<string | null>(null);
	const [isCustomDomainWizardOpen, setIsCustomDomainWizardOpen] = createSignal(false);
	const [wizardStep, setWizardStep] = createSignal<WizardStep>(1);
	const [customDomain, setCustomDomain] = createSignal("");
	const [customDomainError, setCustomDomainError] = createSignal<string | null>(null);
	const [verificationStatus, setVerificationStatus] = createSignal<"idle" | "checking" | "verified" | "misconfigured">("idle");

	createEffect(() => {
		setSlug(props.page.slug);
		setSlugError(null);
	});

	const normalizedSlug = createMemo(() => toSlug(slug()));
	const hasSlugChanges = createMemo(() => normalizedSlug() !== props.page.slug);
	const normalizedCustomDomain = createMemo(() => normalizeDomain(customDomain()) ?? "");
	const displayCustomDomain = createMemo(() => normalizeDomain(props.page.customDomain ?? "") ?? "");
	const hasCustomDomain = createMemo(() => !!displayCustomDomain());
	const statusDomain = normalizeDomain(import.meta.env.VITE_STATUS_PAGE_DOMAIN as string) ?? "";
	const slugPrefix = createMemo(() => `${statusDomain}/`);
	const addressPrefix = createMemo(() => (hasCustomDomain() ? displayCustomDomain() : slugPrefix()));
	const publicStatusUrl = createMemo(() => {
		if (hasCustomDomain()) return `https://${displayCustomDomain()}`;
		return `https://${statusDomain}/${props.page.slug}`;
	});
	const statusCnameTarget = statusDomain;

	const handleOpenWizard = () => {
		const existingDomain = displayCustomDomain();
		if (existingDomain) {
			setCustomDomain(existingDomain);
			setWizardStep(2);
		} else {
			setCustomDomain("");
			setWizardStep(1);
		}
		setCustomDomainError(null);
		setVerificationStatus("idle");
		setIsCustomDomainWizardOpen(true);
	};

	const handleCloseWizard = () => {
		setIsCustomDomainWizardOpen(false);
		setCustomDomain("");
		setCustomDomainError(null);
		setVerificationStatus("idle");
		setWizardStep(1);
	};

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

	const handleAddDomain = async () => {
		const rawInput = customDomain().trim();
		const nextDomain = normalizedCustomDomain();
		if (rawInput && !nextDomain) {
			setCustomDomainError("Enter a valid domain (e.g., status.example.com)");
			return;
		}
		if (nextDomain && !isValidDomain(nextDomain)) {
			setCustomDomainError("Enter a valid domain (e.g., status.example.com)");
			return;
		}
		if (nextDomain && isApexDomain(nextDomain)) {
			setCustomDomainError("Apex domains are not supported. Please use a subdomain (e.g., status.example.com)");
			return;
		}
		if (!nextDomain && !displayCustomDomain()) {
			setCustomDomainError("Domain is required");
			return;
		}
		setCustomDomainError(null);
		try {
			await updateStatusPageMutation.mutateAsync({ id: props.page.id, customDomain: nextDomain || null });
			if (nextDomain) {
				setWizardStep(2);
			} else {
				handleCloseWizard();
			}
		} catch (err) {
			setCustomDomainError(err instanceof Error ? err.message : "Unable to update domain");
		}
	};

	const handleVerifyDomain = async () => {
		setVerificationStatus("checking");
		try {
			const result = await verifyDomainMutation.mutateAsync(props.page.id);
			if (result.verified) {
				setVerificationStatus("verified");
			} else {
				setVerificationStatus("misconfigured");
			}
		} catch {
			setVerificationStatus("misconfigured");
		}
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
									<Show when={props.page.faviconUrl} fallback={<ImageOff class="w-4 h-4 text-rose-500" />}>
										{(url) => <img src={url()} alt="Favicon" class="w-4 h-4 object-contain" />}
									</Show>
								</button>
								<button type="button" class="flex-1 flex items-center px-2 py-1.5 cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => setIsEditingSlug(true)}>
									<Show when={!hasCustomDomain()} fallback={<span class="text-foreground font-medium">{addressPrefix()}</span>}>
										<span class="text-muted-foreground select-none">{addressPrefix()}</span>
										<span class="text-foreground font-medium">{props.page.slug}</span>
									</Show>
								</button>
								<a
									href={publicStatusUrl()}
									target="_blank"
									rel="noreferrer"
									class="flex items-center justify-center w-8 h-8 border-l border-border hover:bg-muted/50 transition-colors shrink-0 text-muted-foreground hover:text-foreground"
								>
									<ExternalLink class="w-4 h-4" />
								</a>
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
								<Show when={props.page.faviconUrl} fallback={<ImageOff class="w-4 h-4 text-rose-500" />}>
									{(url) => <img src={url()} alt="Favicon" class="w-4 h-4 object-contain" />}
								</Show>
							</button>
							<span class="text-muted-foreground select-none pl-2">{slugPrefix()}</span>
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
					<button
						type="button"
						class="flex items-center gap-1.5 shrink-0 text-sm text-muted-foreground/60 hover:text-foreground transition-colors cursor-pointer"
						onClick={handleOpenWizard}
					>
						<Globe class="w-4 h-4" />
						<span class="hidden sm:inline">Custom domain</span>
						<Show when={displayCustomDomain()}>
							<span class="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-emerald-100 text-emerald-700">{displayCustomDomain()}</span>
						</Show>
					</button>
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

			<Dialog open={isCustomDomainWizardOpen()} onOpenChange={(open) => !open && handleCloseWizard()}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Custom domain</DialogTitle>
						<DialogDescription>
							<Show when={wizardStep() === 1}>Enter your custom domain to get started.</Show>
							<Show when={wizardStep() === 2}>Configure your DNS to point to our servers.</Show>
							<Show when={wizardStep() === 3}>Verify that your domain is properly configured.</Show>
						</DialogDescription>
					</DialogHeader>

					{/* Step Indicator */}
					<div class="flex items-center justify-center gap-2 py-2">
						<For each={[1, 2, 3] as const}>
							{(step) => (
								<div class="flex items-center gap-2">
									<div
										class={cn(
											"w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium transition-colors",
											wizardStep() === step ? "bg-blue-500 text-white" : wizardStep() > step ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground",
										)}
									>
										<Show when={wizardStep() > step} fallback={step}>
											<Check class="w-3 h-3" />
										</Show>
									</div>
									<Show when={step < 3}>
										<div class={cn("w-8 h-0.5", wizardStep() > step ? "bg-emerald-500" : "bg-muted")} />
									</Show>
								</div>
							)}
						</For>
					</div>

					{/* Step 1: Add Domain */}
					<Show when={wizardStep() === 1}>
						<div class="space-y-3">
							<div class="space-y-1.5">
								<Label for="status-page-custom-domain">Domain</Label>
								<Input
									id="status-page-custom-domain"
									placeholder="status.example.com"
									value={customDomain()}
									onInput={(e) => {
										setCustomDomain(e.currentTarget.value);
										setCustomDomainError(null);
									}}
									autofocus
								/>
								<p class="text-xs text-muted-foreground">
									Use a subdomain like <span class="font-medium">status.example.com</span>. Apex domains (e.g., example.com) are not supported.
								</p>
								<Show when={customDomainError()}>
									<p class="text-xs text-red-600">{customDomainError()}</p>
								</Show>
							</div>
							<Show when={normalizedCustomDomain()}>
								<p class="text-xs text-muted-foreground">
									Public URL: <span class="font-medium">{`https://${normalizedCustomDomain()}`}</span>
								</p>
							</Show>
						</div>
						<DialogFooter class="gap-2">
							<Button variant="outline" onClick={handleCloseWizard}>
								Cancel
							</Button>
							<Show
								when={!normalizedCustomDomain() && displayCustomDomain()}
								fallback={
									<Button onClick={handleAddDomain} disabled={updateStatusPageMutation.isPending || !normalizedCustomDomain()}>
										<Show
											when={updateStatusPageMutation.isPending}
											fallback={
												<>
													{displayCustomDomain() ? "Update" : "Add Domain"} <ArrowRight class="w-4 h-4 ml-1" />
												</>
											}
										>
											<LoaderCircle class="w-4 h-4 animate-spin mr-2" />
											{displayCustomDomain() ? "Updating..." : "Adding..."}
										</Show>
									</Button>
								}
							>
								<Button variant="destructive" onClick={handleAddDomain} disabled={updateStatusPageMutation.isPending}>
									<Show when={updateStatusPageMutation.isPending} fallback="Remove Domain">
										<LoaderCircle class="w-4 h-4 animate-spin mr-2" />
										Removing...
									</Show>
								</Button>
							</Show>
						</DialogFooter>
					</Show>

					{/* Step 2: Configure DNS */}
					<Show when={wizardStep() === 2}>
						<div class="space-y-4">
							<div class="rounded-lg bg-slate-50 border border-slate-200 p-4 space-y-3">
								<p class="text-sm font-medium text-foreground">DNS Configuration</p>
								<p class="text-sm text-muted-foreground">
									Create a <span class="font-mono bg-slate-200 px-1 rounded">CNAME</span> record with the following settings:
								</p>
								<div class="space-y-2 text-sm">
									<div>
										<div class="text-muted-foreground">Name / Host:</div>
										<div class="font-mono text-foreground break-all">{displayCustomDomain()}</div>
									</div>
									<div>
										<div class="text-muted-foreground">Value / Target:</div>
										<div class="flex items-center gap-2">
											<div class="font-mono text-foreground break-all">{statusCnameTarget}</div>
											<button
												type="button"
												class="p-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer shrink-0"
												onClick={() => navigator.clipboard.writeText(statusCnameTarget)}
											>
												<ClipboardCopy class="w-3.5 h-3.5" />
											</button>
										</div>
									</div>
								</div>
							</div>
							<p class="text-xs text-muted-foreground">DNS changes can take up to hours to propagate, but usually happen within a few minutes.</p>
						</div>
						<DialogFooter class="gap-2">
							<Button variant="outline" onClick={() => setWizardStep(1)}>
								Back
							</Button>
							<Button onClick={() => setWizardStep(3)}>
								Next <ArrowRight class="w-4 h-4 ml-1" />
							</Button>
						</DialogFooter>
					</Show>

					{/* Step 3: Verify */}
					<Show when={wizardStep() === 3}>
						<div class="space-y-4">
							<div class="rounded-lg border p-4 space-y-2">
								<div class="flex items-center justify-between">
									<span class="text-sm font-medium">{displayCustomDomain()}</span>
									<Show when={verificationStatus() !== "idle"} fallback={<span class="text-xs text-muted-foreground">Not checked</span>}>
										<Show when={verificationStatus() === "checking"}>
											<span class="flex items-center gap-1 text-xs text-muted-foreground">
												<LoaderCircle class="w-3 h-3 animate-spin" />
												Checking...
											</span>
										</Show>
										<Show when={verificationStatus() === "verified"}>
											<span class="flex items-center gap-1 text-xs text-emerald-600">
												<CheckCircle class="w-3 h-3" />
												Verified
											</span>
										</Show>
										<Show when={verificationStatus() === "misconfigured"}>
											<span class="flex items-center gap-1 text-xs text-amber-600">
												<AlertTriangle class="w-3 h-3" />
												Not configured
											</span>
										</Show>
									</Show>
								</div>
								<Show when={verificationStatus() === "misconfigured"}>
									<p class="text-xs text-muted-foreground">DNS is not properly configured. Make sure you've added the CNAME record and wait for propagation.</p>
								</Show>
								<Show when={verificationStatus() === "verified"}>
									<p class="text-xs text-emerald-600">Your custom domain is properly configured and ready to use.</p>
								</Show>
							</div>
						</div>
						<DialogFooter class="gap-2">
							<Button variant="outline" onClick={() => setWizardStep(2)}>
								Back
							</Button>
							<Show
								when={verificationStatus() === "verified"}
								fallback={
									<Button onClick={handleVerifyDomain} disabled={verifyDomainMutation.isPending}>
										<Show when={verifyDomainMutation.isPending} fallback="Verify Configuration">
											<LoaderCircle class="w-4 h-4 animate-spin mr-2" />
											Verifying...
										</Show>
									</Button>
								}
							>
								<Button onClick={handleCloseWizard}>Done</Button>
							</Show>
						</DialogFooter>
					</Show>
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
						<div class="w-14 h-14 rounded-xl bg-linear-to-br from-slate-100 to-slate-50 border border-slate-200 flex items-center justify-center text-slate-400">
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

function EditableCompanyName(props: { page: StatusPageData }) {
	const updateStatusPageMutation = useUpdateStatusPage();
	const [isEditingName, setIsEditingName] = createSignal(false);
	const [name, setName] = createSignal(props.page.name);
	const [nameError, setNameError] = createSignal<string | null>(null);

	createEffect(() => {
		setName(props.page.name);
		setNameError(null);
	});

	const trimmedName = createMemo(() => name().trim());
	const hasNameChanges = createMemo(() => trimmedName() !== props.page.name.trim());

	const handleSaveName = async () => {
		const nextName = trimmedName();
		if (!nextName) {
			setNameError("Name is required");
			return;
		}
		setNameError(null);
		try {
			await updateStatusPageMutation.mutateAsync({ id: props.page.id, name: nextName });
			setIsEditingName(false);
		} catch (err) {
			setNameError(err instanceof Error ? err.message : "Unable to update name");
		}
	};

	return (
		<div class="flex items-center">
			<Show
				when={isEditingName()}
				fallback={
					<button type="button" class="text-lg font-semibold text-foreground hover:text-muted-foreground transition-colors" onClick={() => setIsEditingName(true)}>
						{props.page.name.trim() || "Untitled status page"}
					</button>
				}
			>
				<form
					class="flex items-center gap-1"
					onSubmit={(e) => {
						e.preventDefault();
						handleSaveName();
					}}
					onKeyDown={(e) => {
						if (e.key === "Escape") {
							setIsEditingName(false);
							setName(props.page.name);
							setNameError(null);
						}
					}}
				>
					<input
						type="text"
						value={name()}
						onInput={(e) => {
							setName(e.currentTarget.value);
							setNameError(null);
						}}
						class="w-48 px-2 py-1 text-sm border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
						autofocus
					/>
					<button type="submit" class="p-1 text-green-600 hover:text-green-700 cursor-pointer" disabled={updateStatusPageMutation.isPending || !hasNameChanges()}>
						<Show when={updateStatusPageMutation.isPending} fallback={<Check class="w-4 h-4" />}>
							<LoaderCircle class="w-4 h-4 animate-spin" />
						</Show>
					</button>
					<button type="button" class="p-1 text-muted-foreground hover:text-foreground cursor-pointer" onClick={() => setIsEditingName(false)}>
						<X class="w-4 h-4" />
					</button>
				</form>
			</Show>
			<Show when={nameError()}>
				<span class="ml-2 text-xs text-red-600">{nameError()}</span>
			</Show>
		</div>
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

// --- Subscribe Settings ---

function SubscribeSettings(props: { page: StatusPageData }) {
	const updateStatusPageMutation = useUpdateStatusPage();
	const [supportUrl, setSupportUrl] = createSignal(props.page.supportUrl ?? "");

	createEffect(() => {
		setSupportUrl(props.page.supportUrl ?? "");
	});

	const hasChanges = createMemo(() => supportUrl().trim() !== (props.page.supportUrl ?? ""));

	const handleSave = async () => {
		await updateStatusPageMutation.mutateAsync({ id: props.page.id, supportUrl: supportUrl().trim() || null });
	};

	return (
		<div class="rounded-lg border border-dashed border-border p-4 bg-white/70">
			<div class="flex items-start justify-between gap-4">
				<div>
					<p class="text-sm font-medium text-foreground">Subscribe settings</p>
					<p class="text-xs text-muted-foreground mt-1">Used in the “Subscribe to updates” modal.</p>
				</div>
			</div>
			<div class="mt-4 flex items-end gap-3">
				<div class="flex-1 space-y-1">
					<Label for="status-page-support-url" class="text-xs font-medium">
						Support site URL
					</Label>
					<Input id="status-page-support-url" type="url" placeholder="https://help.example.com" value={supportUrl()} onInput={(e) => setSupportUrl(e.currentTarget.value)} />
				</div>
				<Button size="sm" onClick={handleSave} disabled={updateStatusPageMutation.isPending || !hasChanges()}>
					<Show when={updateStatusPageMutation.isPending} fallback="Save">
						<LoaderCircle class="w-3 h-3 animate-spin mr-1" />
						Saving
					</Show>
				</Button>
			</div>
		</div>
	);
}

// --- Services List ---

const DISPLAY_MODE_OPTIONS = [
	{ value: "simple", label: "Simple" },
	{ value: "bars", label: "Uptime bars" },
	{ value: "bars_percentage", label: "Bars with percentage" },
] as const;

function ServicesList(props: { page: StatusPageData }) {
	const servicesQuery = useServices();
	const updateServicesMutation = useUpdateStatusPageServices();
	const updateStatusPageMutation = useUpdateStatusPage();
	const updateDescriptionMutation = useUpdateStatusPageServiceDescription();

	const [draggedId, setDraggedId] = createSignal<string | null>(null);
	const [dropTargetIndex, setDropTargetIndex] = createSignal<number | null>(null);
	const [activeServiceId, setActiveServiceId] = createSignal<string | null>(null);
	const [descriptionInput, setDescriptionInput] = createSignal("");

	const displayMode = () => props.page.serviceDisplayMode || "bars_percentage";

	const availableServices = createMemo(() => servicesQuery.data?.filter((service) => !props.page.services.some((selected) => selected.id === service.id)) ?? []);
	const availableEntities = createMemo(() =>
		availableServices().map((service) => ({ id: service.id, name: service.name?.trim() || "Untitled service", avatar: service.imageUrl })),
	);

	const updateServices = (serviceIds: string[]) => {
		updateServicesMutation.mutate({ id: props.page.id, serviceIds });
	};

	const handleAddService = (service: { id: string }) => {
		updateServices([...props.page.services.map((item) => item.id), service.id]);
	};

	const handleRemoveService = (serviceId: string) => {
		updateServices(props.page.services.filter((item) => item.id !== serviceId).map((item) => item.id));
	};

	const handleDisplayModeChange = (mode: string) => {
		updateStatusPageMutation.mutate({ id: props.page.id, serviceDisplayMode: mode });
	};

	const handleDragStart = (serviceId: string) => {
		setDraggedId(serviceId);
	};

	const handleDragEnd = () => {
		const draggedServiceId = draggedId();
		const targetIndex = dropTargetIndex();

		if (draggedServiceId && targetIndex !== null) {
			const currentIndex = props.page.services.findIndex((service) => service.id === draggedServiceId);
			if (currentIndex !== -1 && currentIndex !== targetIndex) {
				const reordered = props.page.services.map((service) => service.id);
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

	const handleSaveDescription = async (serviceId: string) => {
		await updateDescriptionMutation.mutateAsync({
			statusPageId: props.page.id,
			serviceId,
			description: descriptionInput().trim() || null,
		});
		setActiveServiceId(null);
		setDescriptionInput("");
	};

	return (
		<div class="space-y-3">
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-1">
					<For each={DISPLAY_MODE_OPTIONS}>
						{(option) => (
							<button
								type="button"
								class={cn(
									"px-2.5 py-1 text-xs rounded-md transition-colors cursor-pointer",
									displayMode() === option.value ? "bg-slate-200 text-slate-900 font-medium" : "text-slate-500 hover:text-slate-700 hover:bg-slate-100",
								)}
								onClick={() => handleDisplayModeChange(option.value)}
								disabled={updateStatusPageMutation.isPending}
							>
								{option.label}
							</button>
						)}
					</For>
				</div>
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

			<Show when={props.page.services.length > 0} fallback={<ServicesEmptyState />}>
				<div class="space-y-2">
					<For each={props.page.services}>
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
											<div class="flex-1 min-w-0">
												<div class="flex items-center justify-between">
													<div class="flex items-center gap-1.5">
														<p class="text-sm font-medium text-foreground truncate">{service.name?.trim() || "Untitled service"}</p>
														<Popover>
															<PopoverTrigger
																as="button"
																type="button"
																class={cn(
																	"w-4 h-4 rounded-full text-[10px] font-semibold flex items-center justify-center cursor-pointer transition-colors",
																	service.description?.trim()
																		? "text-slate-500 bg-slate-100 border border-slate-200 hover:bg-slate-200 hover:text-slate-600"
																		: "text-muted-foreground/40 bg-muted/50 hover:bg-muted hover:text-muted-foreground",
																)}
																title={service.description?.trim() || "Add description"}
															>
																?
															</PopoverTrigger>
															<PopoverContent class="w-64 p-3">
																<form
																	class="space-y-2"
																	onSubmit={(e) => {
																		e.preventDefault();
																		handleSaveDescription(service.id);
																	}}
																>
																	<Label for={`service-description-${service.id}`} class="text-xs font-medium">
																		Description
																	</Label>
																	<textarea
																		id={`service-description-${service.id}`}
																		value={activeServiceId() === service.id ? descriptionInput() : (service.description ?? "")}
																		onInput={(e) => setDescriptionInput(e.currentTarget.value)}
																		placeholder="e.g., Login page and auth systems"
																		class="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
																		rows={3}
																		autofocus
																		onFocus={() => {
																			setActiveServiceId(service.id);
																			setDescriptionInput(service.description ?? "");
																		}}
																	/>
																	<div class="flex justify-end">
																		<Button type="submit" size="sm" disabled={updateDescriptionMutation.isPending}>
																			<Show when={updateDescriptionMutation.isPending} fallback="Save">
																				<LoaderCircle class="w-3 h-3 animate-spin mr-1" />
																				Saving
																			</Show>
																		</Button>
																	</div>
																</form>
															</PopoverContent>
														</Popover>
													</div>
													<div class="flex items-center gap-2">
														<Show when={displayMode() === "bars_percentage"}>
															<span class="text-xs text-slate-400">100% uptime</span>
														</Show>
														<div class="flex items-center gap-1">
															<div class="w-2 h-2 rounded-full bg-emerald-500" />
															<span class="text-xs text-emerald-600">Operational</span>
														</div>
													</div>
												</div>
												<Show when={displayMode() !== "simple"}>
													<UptimeBars createdAt={service.createdAt} />
												</Show>
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

function UptimeBars(props: { createdAt: Date | null }) {
	const BAR_COUNT = 60;

	const activeBars = createMemo(() => {
		if (!props.createdAt) return 0;
		const addedDate = new Date(props.createdAt);
		const now = new Date();
		const diffTime = now.getTime() - addedDate.getTime();
		const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
		return Math.min(diffDays, BAR_COUNT);
	});

	return (
		<div class="flex gap-0.5 mt-2">
			<For each={Array(BAR_COUNT).fill(0)}>
				{(_, index) => {
					const isActive = () => index() >= BAR_COUNT - activeBars();
					return (
						<div
							class="flex-1 h-4 rounded-sm min-w-0.75"
							classList={{
								"bg-emerald-500": isActive(),
								"bg-slate-200": !isActive(),
							}}
						/>
					);
				}}
			</For>
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

	const appOrigin = new URL(import.meta.env.VITE_APP_URL as string).origin;

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
				<a href={appOrigin} class="flex items-center gap-1.5 hover:text-muted-foreground transition-colors" target="_blank" rel="noreferrer">
					Powered by <Flame class="w-3.5 h-3.5 text-orange-500" />
				</a>
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
					<div class="relative p-3 rounded-full bg-linear-to-br from-slate-100 to-slate-50 border border-slate-200/60">
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
	);
}
