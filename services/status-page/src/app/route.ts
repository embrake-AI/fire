import { buildStatusPageResponse } from "@/lib/status-pages.render";
import { fetchPublicStatusPageByDomain } from "@/lib/status-pages.server";
import { normalizeDomain } from "@/lib/status-pages.utils";
import type { NextRequest } from "next/server";

export const revalidate = 30;

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

	const data = await fetchPublicStatusPageByDomain(host);

	if (!data) {
		return new Response("Not found", { status: 404 });
	}

	return buildStatusPageResponse(data);
}
