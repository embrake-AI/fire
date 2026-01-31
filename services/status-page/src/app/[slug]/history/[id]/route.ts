import type { NextRequest } from "next/server";
import { buildIncidentDetailResponse } from "@/lib/status-pages.render";
import { fetchIncidentDetailBySlug } from "@/lib/status-pages.server";
import { normalizeDomain } from "@/lib/status-pages.utils";

export const revalidate = 30;

function getRequestHost(request: NextRequest): string | null {
	const forwardedHost = request.headers.get("x-forwarded-host");
	const rawHost = (forwardedHost ?? request.headers.get("host") ?? "").split(",")[0]?.trim();
	if (!rawHost) return null;
	return normalizeDomain(rawHost);
}

const PRIMARY_DOMAIN = process.env.VITE_STATUS_PAGE_DOMAIN ?? "";

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string; id: string }> }) {
	const { slug, id } = await params;
	const host = getRequestHost(request);

	if (!PRIMARY_DOMAIN) {
		return new Response("Configuration error", { status: 500 });
	}

	// Slug-based access is only allowed from the primary domain
	if (host !== PRIMARY_DOMAIN) {
		return new Response("Not found", { status: 404 });
	}

	const data = await fetchIncidentDetailBySlug(slug, id);

	if (!data) {
		return new Response("Not found", { status: 404 });
	}

	const isActive = !data.incident.resolvedAt;
	return buildIncidentDetailResponse(data, isActive, `/${slug}`);
}
