import type { IS } from "@fire/common";
import { createServerFn } from "@tanstack/solid-start";

export const getIncidents = createServerFn({
	method: "GET",
}).handler(async () => {
	const response = await fetch(process.env.INCIDENTS_URL!);
	if (!response.ok) {
		throw new Error("Failed to fetch incidents");
	}
	const { incidents } = (await response.json()) as { incidents: IS[] };
	return incidents;
});

export const getIncidentById = createServerFn({ method: "GET" })
	.inputValidator((data: { id: string }) => data)
	.handler(async ({ data }) => {
		const response = await fetch(`${process.env.INCIDENTS_URL}/${data.id}`);
		if (!response.ok) {
			throw new Error("Failed to fetch incident");
		}
		const { incident } = (await response.json()) as { incident: IS };
		return incident;
	});

export const updateAssignee = createServerFn({ method: "POST" })
	.inputValidator((data: { id: string; assignee: string }) => data)
	.handler(async ({ data }) => {
		const response = await fetch(`${process.env.INCIDENTS_URL}/${data.id}/assignee`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ assignee: data.assignee }),
		});
		if (!response.ok) {
			throw new Error("Failed to update assignee");
		}
		const { incident } = (await response.json()) as { incident: IS };
		return incident;
	});

export const updatePriority = createServerFn({ method: "POST" })
	.inputValidator((data: { id: string; priority: IS["severity"] }) => data)
	.handler(async ({ data }) => {
		const response = await fetch(`${process.env.INCIDENTS_URL}/${data.id}/priority`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ priority: data.priority }),
		});
		if (!response.ok) {
			throw new Error("Failed to update priority");
		}
		const { incident } = (await response.json()) as { incident: IS };
		return incident;
	});

export const startIncident = createServerFn({ method: "POST" })
	.inputValidator((data: { prompt: string }) => data)
	.handler(async ({ data }) => {
		const response = await fetch(process.env.INCIDENTS_URL!, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ prompt: data.prompt }),
		});
		if (!response.ok) {
			throw new Error("Failed to start incident");
		}
		const { incident } = (await response.json()) as { incident: IS };
		return incident;
	});
