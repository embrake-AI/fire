import { buildIncidentDetailResponse } from "@/lib/status-pages.render";
import { fetchIncidentDetailByDomain } from "@/lib/status-pages.server";
import { normalizeDomain } from "@/lib/status-pages.utils";
import type { NextRequest } from "next/server";

export const revalidate = 30;

function getRequestHost(request: NextRequest): string | null {
	const forwardedHost = request.headers.get("x-forwarded-host");
	const rawHost = (forwardedHost ?? request.headers.get("host") ?? "").split(",")[0]?.trim();
	if (!rawHost) return null;
	return normalizeDomain(rawHost);
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const host = getRequestHost(request);

	if (!host) {
		return new Response("Not found", { status: 404 });
	}

	const data = await fetchIncidentDetailByDomain(host, id);

	if (!data) {
		return new Response("Not found", { status: 404 });
	}

	const isActive = !data.incident.resolvedAt;
	return buildIncidentDetailResponse(data, isActive);
}
