import type { NextRequest } from "next/server";
import { buildHistoryFeedResponse, type FeedFormat } from "@/lib/status-pages.feed";
import { buildStatusPageResponse } from "@/lib/status-pages.render";
import { fetchIncidentHistoryByDomain, fetchPublicStatusPageBySlug } from "@/lib/status-pages.server";
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

function parseFeedFormat(feed: string): FeedFormat | null {
	if (feed === "feed.rss") return "rss";
	if (feed === "feed.atom") return "atom";
	return null;
}

const PRIMARY_DOMAIN = process.env.VITE_STATUS_PAGE_DOMAIN ?? "";

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
	const { slug } = await params;
	const host = getRequestHost(request);

	if (!PRIMARY_DOMAIN) {
		return new Response("Configuration error", { status: 500 });
	}

	if (!host) {
		return new Response("Not found", { status: 404 });
	}

	const feedFormat = parseFeedFormat(slug);
	if (feedFormat && host !== PRIMARY_DOMAIN) {
		const data = await fetchIncidentHistoryByDomain(host);
		if (!data) {
			return new Response("Not found", { status: 404 });
		}

		const origin = getRequestOrigin(request) ?? request.nextUrl.origin;
		const siteUrl = new URL("/", origin).toString();
		const feedUrl = new URL(request.nextUrl.pathname, origin).toString();

		return buildHistoryFeedResponse({ data, format: feedFormat, feedUrl, siteUrl });
	}

	// Slug-based access is only allowed from the primary domain
	if (host !== PRIMARY_DOMAIN) {
		return new Response("Not found", { status: 404 });
	}

	const data = await fetchPublicStatusPageBySlug(slug);

	if (!data) {
		return new Response("Not found", { status: 404 });
	}

	return buildStatusPageResponse(data, `/${slug}`);
}
