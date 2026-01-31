import type { NextRequest } from "next/server";
import { buildIncidentFeedResponse, normalizeFeedFormat } from "@/lib/status-pages.feed";
import { fetchIncidentDetailByDomain } from "@/lib/status-pages.server";
import { normalizeDomain } from "@/lib/status-pages.utils";

export const revalidate = 30;

function getRequestHost(request: NextRequest): string | null {
	const forwardedHost = request.headers.get("x-forwarded-host");
	const rawHost = (forwardedHost ?? request.headers.get("host") ?? "").split(",")[0]?.trim();
	if (!rawHost) return null;
	return normalizeDomain(rawHost);
}

function getRequestOrigin(request: NextRequest): string | null {
	const forwardedHost = request.headers.get("x-forwarded-host");
	const rawHost = (forwardedHost ?? request.headers.get("host") ?? "").split(",")[0]?.trim();
	if (!rawHost) return null;
	const forwardedProto = request.headers.get("x-forwarded-proto");
	const protocol = forwardedProto ?? request.nextUrl.protocol.replace(":", "") ?? "https";
	return `${protocol}://${rawHost}`;
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

	const origin = getRequestOrigin(request) ?? request.nextUrl.origin;
	const siteUrl = new URL(`/history/${id}`, origin).toString();
	const feedUrl = new URL(request.nextUrl.pathname + request.nextUrl.search, origin).toString();
	const format = normalizeFeedFormat(request.nextUrl.searchParams.get("format"));

	return buildIncidentFeedResponse({
		data,
		format,
		feedUrl,
		siteUrl,
	});
}
