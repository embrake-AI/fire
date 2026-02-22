import { useMutation } from "@tanstack/solid-query";
import { isDemoMode } from "../demo/mode";
import { createUserFacingError } from "../errors/user-facing-error";

export type UploadImageType = "user" | "client" | "team" | "service" | "status-page";

type UploadImageInput = {
	file?: File | null;
	url?: string;
};

type UploadImageResult = {
	imageUrl: string;
};

type UploadErrorResponse = {
	error?: string;
	userMessage?: string;
	code?: string;
};

type UploadImageOptions = {
	onMutate?: (variables: UploadImageInput) => void;
	onSuccess?: (data: UploadImageResult, variables: UploadImageInput) => void;
	onError?: (error: unknown, variables: UploadImageInput) => void;
	onSettled?: (data: UploadImageResult | undefined, error: unknown | null, variables: UploadImageInput) => void;
};

async function toDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const result = reader.result;
			if (typeof result !== "string") {
				reject(new Error("Failed to read image"));
				return;
			}
			resolve(result);
		};
		reader.onerror = () => reject(new Error("Failed to read image"));
		reader.readAsDataURL(file);
	});
}

async function uploadImage(type: UploadImageType, { file, url }: UploadImageInput): Promise<UploadImageResult> {
	if (!file && !url) {
		throw new Error("No image provided");
	}

	if (isDemoMode()) {
		if (url?.trim()) {
			return { imageUrl: url.trim() };
		}
		if (file) {
			return { imageUrl: await toDataUrl(file) };
		}
		throw new Error("No image provided");
	}

	const formData = new FormData();
	if (file) {
		formData.append("file", file);
	} else if (url?.trim()) {
		formData.append("url", url.trim());
	}
	formData.append("type", type);

	const response = await fetch("/api/upload", {
		method: "POST",
		body: formData,
	});

	if (!response.ok) {
		let payload: UploadErrorResponse | null = null;

		try {
			payload = (await response.json()) as UploadErrorResponse;
		} catch {
			payload = null;
		}

		const message = payload?.userMessage?.trim() || payload?.error?.trim() || (response.status === 403 ? "You don't have permission to perform this action." : "Upload failed");
		const code = payload?.code;
		throw createUserFacingError(message, code ? { code } : undefined);
	}

	const data = (await response.json()) as { url: string };
	return { imageUrl: data.url };
}

export function useUploadImage(type: UploadImageType, options?: UploadImageOptions) {
	return useMutation(() => ({
		mutationFn: (variables: UploadImageInput) => uploadImage(type, variables),
		onMutate: (variables) => options?.onMutate?.(variables),
		onSuccess: (data, variables) => options?.onSuccess?.(data, variables),
		onError: (error, variables) => options?.onError?.(error, variables),
		onSettled: (data, error, variables) => options?.onSettled?.(data, error ?? null, variables),
	}));
}
