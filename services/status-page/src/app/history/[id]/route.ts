import type { NextRequest } from "next/server";
import { buildHistoryFeedResponse, type FeedFormat } from "@/lib/status-pages.feed";
import { buildIncidentDetailResponse } from "@/lib/status-pages.render";
import { fetchIncidentDetailByDomain, fetchIncidentHistoryByDomain } from "@/lib/status-pages.server";
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

function parseFeedFormat(id: string): FeedFormat | null {
	if (id === "feed.rss") return "rss";
	if (id === "feed.atom") return "atom";
	return null;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const host = getRequestHost(request);

	if (!host) {
		return new Response("Not found", { status: 404 });
	}

	// Handle feed requests: /history/feed.rss or /history/feed.atom
	const feedFormat = parseFeedFormat(id);
	if (feedFormat) {
		const data = await fetchIncidentHistoryByDomain(host);
		if (!data) {
			return new Response("Not found", { status: 404 });
		}
		const origin = getRequestOrigin(request) ?? request.nextUrl.origin;
		const siteUrl = new URL("/", origin).toString();
		const feedUrl = new URL(request.nextUrl.pathname, origin).toString();
		return buildHistoryFeedResponse({ data, format: feedFormat, feedUrl, siteUrl });
	}

	// Handle incident detail requests
	const data = await fetchIncidentDetailByDomain(host, id);

	if (!data) {
		return new Response("Not found", { status: 404 });
	}

	const isActive = !data.incident.resolvedAt;
	return buildIncidentDetailResponse(data, isActive);
}
