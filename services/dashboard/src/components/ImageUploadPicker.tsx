import { ImageUp } from "lucide-solid";
import { type Accessor, createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils/client";

type ImageUploadPickerProps = {
	description: string;
	previewClass: string;
	imageFile: Accessor<File | null>;
	setImageFile: (file: File | null) => void;
	droppedImageUrl: Accessor<string>;
	setDroppedImageUrl: (url: string) => void;
	previewFallback?: string | null;
	inputId?: string;
	/** Maximum file size in bytes. Default: 2MB */
	maxSizeBytes?: number;
	/** Called when validation error state changes */
	onValidationError?: (error: string | null) => void;
};

const DEFAULT_MAX_SIZE = 2 * 1024 * 1024; // 2MB

export function ImageUploadPicker(props: ImageUploadPickerProps) {
	const [isDragActive, setIsDragActive] = createSignal(false);
	const [sizeError, setSizeError] = createSignal<string | null>(null);
	let fileInputRef: HTMLInputElement | undefined;

	const maxSize = () => props.maxSizeBytes ?? DEFAULT_MAX_SIZE;

	const formatFileSize = (size: number) => {
		if (size < 1024) return `${size} B`;
		if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
		return `${(size / (1024 * 1024)).toFixed(1)} MB`;
	};

	const selectedFileDetails = createMemo(() => {
		const file = props.imageFile();
		return file ? { name: file.name, size: formatFileSize(file.size) } : null;
	});

	const [previewUrl, setPreviewUrl] = createSignal<string | null>(null);

	createEffect(() => {
		const file = props.imageFile();
		if (!file) {
			setPreviewUrl(null);
			return;
		}
		const objectUrl = URL.createObjectURL(file);
		setPreviewUrl(objectUrl);
		onCleanup(() => URL.revokeObjectURL(objectUrl));
	});

	const previewSource = createMemo(() => previewUrl() || props.droppedImageUrl() || props.previewFallback || "");

	const handleSelectedFile = (file: File | null) => {
		setSizeError(null);
		props.onValidationError?.(null);
		if (!file || !file.type.startsWith("image/")) {
			return;
		}
		if (file.size > maxSize()) {
			const error = `File too large. Maximum size is ${formatFileSize(maxSize())}.`;
			setSizeError(error);
			props.onValidationError?.(error);
			return;
		}
		props.setImageFile(file);
		props.setDroppedImageUrl("");
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
		props.setDroppedImageUrl(normalized);
		props.setImageFile(null);
	};

	return (
		<>
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
							<p class="text-xs text-muted-foreground">{props.description}</p>
						</div>
						<div class="flex items-center gap-2">
							<Input
								ref={(el) => {
									fileInputRef = el;
								}}
								id={props.inputId}
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
					<Show when={sizeError()}>{(error) => <p class="text-xs text-red-600">{error()}</p>}</Show>
				</CardContent>
			</Card>
			<Show when={previewSource()}>
				{(src) => (
					<div class="flex justify-center">
						<div class={props.previewClass}>
							<img src={src()} alt="Preview" class="h-full w-full object-cover" />
						</div>
					</div>
				)}
			</Show>
		</>
	);
}
