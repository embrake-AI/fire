import { buildIntercomCanvasResponse, verifyIntercomSignature } from "@/lib/intercom.server";

export async function POST(request: Request) {
	const rawBody = await request.text();
	const signature = request.headers.get("x-body-signature");

	if (!verifyIntercomSignature(rawBody, signature)) {
		return new Response("Invalid signature", { status: 401 });
	}

	const response = await buildIntercomCanvasResponse(rawBody, new URL(request.url).origin);

	return new Response(JSON.stringify(response), {
		status: 200,
		headers: {
			"Content-Type": "application/json",
		},
	});
}
