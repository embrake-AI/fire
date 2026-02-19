import { cacheLife } from "next/cache";
import { buildIntercomCanvasContentResponseByStatusPageId } from "@/lib/intercom.server";

async function getCachedIntercomCanvasContentResponseByStatusPageId(statusPageId: string) {
	"use cache";
	cacheLife({ revalidate: 30, expire: 60 });
	return buildIntercomCanvasContentResponseByStatusPageId(statusPageId);
}

export async function POST(_request: Request, { params }: { params: Promise<{ statusPageId: string }> }) {
	const { statusPageId } = await params;
	const response = await getCachedIntercomCanvasContentResponseByStatusPageId(statusPageId);
	if (response.status !== 200) {
		return new Response("Not found", { status: response.status });
	}

	return new Response(JSON.stringify(response.response), {
		status: 200,
		headers: {
			"Content-Type": "application/json",
		},
	});
}
