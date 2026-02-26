import { buildIntercomInboxCanvasInitializeResponse, verifyIntercomSignature } from "@/lib/intercom.server";

export async function POST(request: Request) {
	const rawBody = await request.text();
	const signature = request.headers.get("x-body-signature");

	if (!verifyIntercomSignature(rawBody, signature)) {
		return new Response("Invalid signature", { status: 401 });
	}

	const response = await buildIntercomInboxCanvasInitializeResponse(rawBody);
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
