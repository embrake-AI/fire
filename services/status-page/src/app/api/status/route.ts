import type { NextRequest } from "next/server";
import { buildStatusSnapshotResponse } from "@/lib/status-pages.api";
import { fetchStatusSnapshotByDomain } from "@/lib/status-pages.server";
import { normalizeDomain } from "@/lib/status-pages.utils";

export const revalidate = 10;

function getRequestHost(request: NextRequest): string | null {
	const forwardedHost = request.headers.get("x-forwarded-host");
	const rawHost = (forwardedHost ?? request.headers.get("host") ?? "").split(",")[0]?.trim();
	if (!rawHost) return null;
	return normalizeDomain(rawHost);
}

export async function GET(request: NextRequest) {
	const host = getRequestHost(request);
	if (!host) {
		return new Response("Not found", { status: 404 });
	}

	const snapshot = await fetchStatusSnapshotByDomain(host);
	if (!snapshot) {
		return new Response("Not found", { status: 404 });
	}

	return buildStatusSnapshotResponse({ snapshot });
}
