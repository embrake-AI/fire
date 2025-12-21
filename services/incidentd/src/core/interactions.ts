import type { IS } from "@fire/common";
import type { Context } from "hono";

type EnvContext = Context<{ Bindings: Env }>;

export async function startIncident({
	c,
	identifier,
	prompt,
	createdBy,
	source,
}: {
	c: EnvContext;
	identifier: string;
} & Pick<IS, "prompt" | "createdBy" | "source">) {
	const incidentId = c.env.INCIDENT.idFromName(identifier);
	const incident = c.env.INCIDENT.get(incidentId);
	const result = await incident.start({
		id: incidentId.toString(),
		prompt,
		createdBy,
		source,
	});
	await c.env.incidents
		.prepare("INSERT INTO incident (id, identifier, status, assignee, severity, title, description) VALUES (?, ?, ?, ?, ?, ?, ?)")
		.bind(incidentId.toString(), identifier, "open", result.assignee, result.severity, result.title, result.description)
		.run();
	return result;
}

export async function listIncidents({ c }: { c: EnvContext }) {
	const incidents = await c.env.incidents.prepare("SELECT id, identifier, status, assignee, severity, createdAt FROM incident").all<{
		id: number;
		identifier: string;
		status: string;
		assignee: string;
		severity: string;
		createdAt: string;
	}>();
	return incidents.results;
}

export async function getIncident({ c, id }: { c: EnvContext; id: string }) {
	const incidentId = c.env.INCIDENT.idFromString(id);
	const incident = c.env.INCIDENT.get(incidentId);
	return incident.get();
}

export async function updatePriority({ c, id, priority }: { c: EnvContext; id: string; priority: IS["severity"] }) {
	const incidentId = c.env.INCIDENT.idFromString(id);
	const incident = c.env.INCIDENT.get(incidentId);
	await incident.setPriority(priority);
	await c.env.incidents.prepare("UPDATE incident SET severity = ? WHERE id = ?").bind(priority, incidentId.toString()).run();
}

export async function updateAssignee({ c, id, assignee }: { c: EnvContext; id: string; assignee: IS["assignee"] }) {
	const incidentId = c.env.INCIDENT.idFromString(id);
	const incident = c.env.INCIDENT.get(incidentId);
	await incident.setAssignee(assignee);
	await c.env.incidents.prepare("UPDATE incident SET assignee = ? WHERE id = ?").bind(assignee, incidentId.toString()).run();
}
