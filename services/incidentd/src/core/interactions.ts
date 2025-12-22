import type { IS } from "@fire/common";
import type { Context } from "hono";

// Base env type that all contexts must have
type BasicContext = { Bindings: Env };

// Context that requires auth with clientId
export type AuthContext = BasicContext & { Variables: { auth: { clientId: string } } };

export async function startIncident<E extends AuthContext>({
	c,
	identifier,
	prompt,
	createdBy,
	source,
}: {
	c: Context<E>;
	identifier: string;
} & Pick<IS, "prompt" | "createdBy" | "source">) {
	const incidentId = c.env.INCIDENT.idFromName(identifier);
	const incident = c.env.INCIDENT.get(incidentId);
	// const clientId = c.var.auth.clientId;
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

export async function listIncidents<E extends AuthContext>({ c }: { c: Context<E> }) {
	// const clientId = c.var.auth.clientId;
	const incidents = await c.env.incidents.prepare("SELECT id, identifier, status, assignee, severity, createdAt, title, description FROM incident").all<{
		id: number;
		identifier: string;
		status: string;
		assignee: string;
		severity: string;
		createdAt: string;
		title: string;
		description: string;
	}>();
	return incidents.results;
}

export async function getIncident<E extends BasicContext>({ c, id }: { c: Context<E>; id: string }) {
	const incidentId = c.env.INCIDENT.idFromString(id);
	const incident = c.env.INCIDENT.get(incidentId);
	return incident.get();
}

export async function updatePriority<E extends BasicContext>({ c, id, priority }: { c: Context<E>; id: string; priority: IS["severity"] }) {
	const incidentId = c.env.INCIDENT.idFromString(id);
	const incident = c.env.INCIDENT.get(incidentId);
	const updatedIncident = await incident.setPriority(priority);
	await c.env.incidents.prepare("UPDATE incident SET severity = ? WHERE id = ?").bind(priority, incidentId.toString()).run();
	return updatedIncident;
}

export async function updateAssignee<E extends BasicContext>({ c, id, assignee }: { c: Context<E>; id: string; assignee: IS["assignee"] }) {
	const incidentId = c.env.INCIDENT.idFromString(id);
	const incident = c.env.INCIDENT.get(incidentId);
	const updatedIncident = await incident.setAssignee(assignee);
	await c.env.incidents.prepare("UPDATE incident SET assignee = ? WHERE id = ?").bind(assignee, incidentId.toString()).run();
	return updatedIncident;
}
