import { buildIntercomCanvasContentResponseByStatusPageId, verifyIntercomSignature } from "@/lib/intercom.server";

const INTERCOM_CANVAS_CACHE_CONTROL = "public, max-age=3, stale-while-revalidate=30, stale-if-error=3600";
const INTERCOM_CANVAS_CDN_CACHE_CONTROL = "public, s-maxage=30, stale-while-revalidate=30, stale-if-error=3600";

export async function POST(request: Request, { params }: { params: Promise<{ statusPageId: string }> }) {
	const rawBody = await request.text();
	const signature = request.headers.get("x-body-signature");

	if (!verifyIntercomSignature(rawBody, signature)) {
		return new Response("Invalid signature", { status: 401 });
	}

	const { statusPageId } = await params;
	const response = await buildIntercomCanvasContentResponseByStatusPageId(statusPageId, new URL(request.url).origin);
	if (response.status !== 200) {
		return new Response("Not found", { status: response.status });
	}

	return new Response(JSON.stringify(response.response), {
		status: 200,
		headers: {
			"Content-Type": "application/json",
			"Cache-Control": INTERCOM_CANVAS_CACHE_CONTROL,
			"CDN-Cache-Control": INTERCOM_CANVAS_CDN_CACHE_CONTROL,
			"Vercel-CDN-Cache-Control": INTERCOM_CANVAS_CDN_CACHE_CONTROL,
		},
	});
}
