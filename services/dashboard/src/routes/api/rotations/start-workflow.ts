import { rotation } from "@fire/db/schema";
import { createFileRoute } from "@tanstack/solid-router";
import { and, eq, inArray } from "drizzle-orm";
import { start } from "workflow/api";
import { auth } from "~/lib/auth/auth";
import { forbiddenJsonResponse, isAllowed } from "~/lib/auth/authorization";
import { db } from "~/lib/db";
import { rotationScheduleWorkflow } from "~/workflows/rotation/schedule";

type StartWorkflowInput = {
	rotationId?: string;
	rotationIds?: string[];
	all?: boolean;
};

function asBoolean(value: string | null): boolean {
	if (!value) {
		return false;
	}

	return value === "1" || value.toLowerCase() === "true";
}

function normalizeRotationIds(input: StartWorkflowInput, url: URL): { all: boolean; rotationIds: string[] } {
	const rotationIdFromQuery = url.searchParams.get("rotationId")?.trim() ?? "";
	const rotationIdsFromQuery = (url.searchParams.get("rotationIds") ?? "")
		.split(",")
		.map((id) => id.trim())
		.filter(Boolean);
	const allFromQuery = asBoolean(url.searchParams.get("all"));

	const all = Boolean(input.all || allFromQuery);
	const ids = [
		...(input.rotationId?.trim() ? [input.rotationId.trim()] : []),
		...(input.rotationIds ?? []).map((id) => id.trim()).filter(Boolean),
		...(rotationIdFromQuery ? [rotationIdFromQuery] : []),
		...rotationIdsFromQuery,
	];

	return {
		all,
		rotationIds: [...new Set(ids)],
	};
}

async function readJsonBody(request: Request): Promise<StartWorkflowInput> {
	if (request.method !== "POST") {
		return {};
	}

	try {
		const json = (await request.json()) as StartWorkflowInput;
		return json ?? {};
	} catch {
		return {};
	}
}

export const Route = createFileRoute("/api/rotations/start-workflow")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				return handleStartRotationWorkflow(request);
			},
			POST: async ({ request }) => {
				return handleStartRotationWorkflow(request);
			},
		},
	},
});

async function handleStartRotationWorkflow(request: Request): Promise<Response> {
	const session = await auth.api.getSession({ headers: request.headers });
	const clientId = session?.user?.clientId;
	const role = session?.user?.role;

	if (!clientId) {
		return new Response(JSON.stringify({ error: "Unauthorized" }), {
			status: 401,
			headers: { "Content-Type": "application/json" },
		});
	}
	if (!isAllowed(role, "rotationWorkflow.trigger")) {
		return forbiddenJsonResponse();
	}

	const url = new URL(request.url);
	const body = await readJsonBody(request);
	const { all, rotationIds } = normalizeRotationIds(body, url);

	let requestedIds = rotationIds;
	if (all) {
		const rows = await db.select({ id: rotation.id }).from(rotation).where(eq(rotation.clientId, clientId));
		requestedIds = rows.map((row) => row.id);
	}

	if (requestedIds.length === 0) {
		return new Response(
			JSON.stringify({
				error: "No rotation IDs provided",
				hint: "Pass ?rotationId=<id>, ?rotationIds=<id1,id2>, or ?all=1",
			}),
			{
				status: 400,
				headers: { "Content-Type": "application/json" },
			},
		);
	}

	const existingRows = await db
		.select({ id: rotation.id })
		.from(rotation)
		.where(and(eq(rotation.clientId, clientId), inArray(rotation.id, requestedIds)));

	const existingIds = new Set(existingRows.map((row) => row.id));
	const missingIds = requestedIds.filter((id) => !existingIds.has(id));

	const startedIds: string[] = [];
	const failed: Array<{ rotationId: string; error: string }> = [];

	for (const rotationId of existingIds) {
		try {
			await start(rotationScheduleWorkflow, [{ rotationId }]);
			startedIds.push(rotationId);
		} catch (error) {
			failed.push({
				rotationId,
				error: error instanceof Error ? error.message : "Unknown error",
			});
		}
	}

	return new Response(
		JSON.stringify({
			requested: requestedIds.length,
			started: startedIds,
			missing: missingIds,
			failed,
		}),
		{
			status: 200,
			headers: { "Content-Type": "application/json" },
		},
	);
}
