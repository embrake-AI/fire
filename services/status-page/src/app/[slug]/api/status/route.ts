import type { NextRequest } from "next/server";
import { buildStatusSnapshotResponse } from "@/lib/status-pages.api";
import { fetchStatusSnapshotBySlug } from "@/lib/status-pages.server";
import { normalizeDomain } from "@/lib/status-pages.utils";

export const revalidate = 30;

const PRIMARY_DOMAIN = process.env.VITE_STATUS_PAGE_DOMAIN ?? "";

function getRequestHost(request: NextRequest): string | null {
	const forwardedHost = request.headers.get("x-forwarded-host");
	const rawHost = (forwardedHost ?? request.headers.get("host") ?? "").split(",")[0]?.trim();
	if (!rawHost) return null;
	return normalizeDomain(rawHost);
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
	const { slug } = await params;
	const host = getRequestHost(request);

	if (!PRIMARY_DOMAIN) {
		return new Response("Configuration error", { status: 500 });
	}

	if (!host || host !== PRIMARY_DOMAIN) {
		return new Response("Not found", { status: 404 });
	}

	const snapshot = await fetchStatusSnapshotBySlug(slug);
	if (!snapshot) {
		return new Response("Not found", { status: 404 });
	}

	return buildStatusSnapshotResponse({
		snapshot,
		ifNoneMatch: request.headers.get("if-none-match"),
	});
}
