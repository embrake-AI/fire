import { put } from "@vercel/blob";
import { nanoid } from "nanoid";

const cacheControlMaxAge = 60 * 60 * 24 * 365;

function getExtensionFromContentType(contentType: string) {
	const parts = contentType.split("/");
	const ext = parts[1]?.split(";")[0]?.trim();
	return ext || "bin";
}

function getExtensionFromName(name: string) {
	const parts = name.split(".");
	const ext = parts.length > 1 ? parts[parts.length - 1] : "";
	return ext || "bin";
}

export async function uploadImageFromUrl(url: string, prefix: string): Promise<string | null> {
	if (!process.env.FIRE_IMAGES_READ_WRITE_TOKEN) {
		return null;
	}

	let parsedUrl: URL;
	try {
		parsedUrl = new URL(url);
	} catch {
		return null;
	}

	if (parsedUrl.protocol !== "https:") {
		return null;
	}

	const response = await fetch(parsedUrl.toString(), { redirect: "follow" });
	if (!response.ok) {
		return null;
	}

	const contentType = response.headers.get("content-type") ?? "";
	if (!contentType.startsWith("image/")) {
		return null;
	}

	const extension = getExtensionFromContentType(contentType);
	const pathname = `${prefix}/${nanoid()}.${extension}`;
	const body = new Blob([await response.arrayBuffer()], { type: contentType });

	const blob = await put(pathname, body, {
		token: process.env.FIRE_IMAGES_READ_WRITE_TOKEN,
		access: "public",
		contentType,
		cacheControlMaxAge,
	});

	return blob.url;
}

export async function uploadImageFile(file: File, prefix: string): Promise<string | null> {
	if (!process.env.FIRE_IMAGES_READ_WRITE_TOKEN) {
		return null;
	}

	const contentType = file.type || "application/octet-stream";
	if (!contentType.startsWith("image/")) {
		return null;
	}

	const extension = getExtensionFromName(file.name || "");
	const pathname = `${prefix}/${nanoid()}.${extension}`;

	const blob = await put(pathname, file, {
		token: process.env.FIRE_IMAGES_READ_WRITE_TOKEN,
		access: "public",
		contentType,
		cacheControlMaxAge,
	});

	return blob.url;
}
