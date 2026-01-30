import { buildStatusPageResponse } from "@/lib/status-pages.render";
import { fetchPublicStatusPageBySlug, fetchPublicStatusPageByDomain } from "@/lib/status-pages.server";
import { normalizeDomain } from "@/lib/status-pages.utils";
import { type NextRequest, NextResponse } from "next/server";

export const revalidate = 30;

function getRequestHost(request: NextRequest): string | null {
	const forwardedHost = request.headers.get("x-forwarded-host");
	const rawHost = (forwardedHost ?? request.headers.get("host") ?? "").split(",")[0]?.trim();
	if (!rawHost) return null;
	return normalizeDomain(rawHost);
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
	const { slug } = await params;
	const host = getRequestHost(request);

	// Check if the host matches a custom domain - if so, redirect to root
	if (host) {
		const domainMatch = await fetchPublicStatusPageByDomain(host);
		if (domainMatch) {
			return NextResponse.redirect(new URL("/", request.url), 307);
		}
	}

	const data = await fetchPublicStatusPageBySlug(slug);

	if (!data) {
		return new Response("Not found", { status: 404 });
	}

	return buildStatusPageResponse(data);
}
