import { useMutation } from "@tanstack/solid-query";

export type UploadImageType = "user" | "client" | "team";

type UploadImageInput = {
	file?: File | null;
	url?: string;
};

type UploadImageResult = {
	imageUrl: string;
};

type UploadImageOptions = {
	onMutate?: (variables: UploadImageInput) => void;
	onSuccess?: (data: UploadImageResult, variables: UploadImageInput) => void;
	onError?: (error: unknown, variables: UploadImageInput) => void;
	onSettled?: (data: UploadImageResult | undefined, error: unknown | null, variables: UploadImageInput) => void;
};

async function uploadImage(type: UploadImageType, { file, url }: UploadImageInput): Promise<UploadImageResult> {
	if (!file && !url) {
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
		throw new Error("Upload failed");
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
