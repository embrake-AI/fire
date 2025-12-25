import type { EntryPoint, IS } from "@fire/common";
import type { Context } from "hono";

export type BasicContext = { Bindings: Env };
export type AuthContext = BasicContext & { Variables: { auth: { clientId: string } } };
export type Metadata = Record<string, string> & { clientId: string; identifier: string };

export async function startIncident<E extends AuthContext>({
	c,
	m,
	prompt,
	createdBy,
	source,
	identifier,
	entryPoints,
}: {
	c: Context<E>;
	m: Omit<Metadata, "clientId">;
	identifier: string;
	entryPoints: EntryPoint[];
} & Pick<IS, "prompt" | "createdBy" | "source">) {
	const clientId = c.var.auth.clientId;
	const metadata = { ...m, clientId, identifier };
	const incidentId = c.env.INCIDENT.idFromName(identifier);
	const incident = c.env.INCIDENT.get(incidentId);
	await incident.start(
		{
			id: incidentId.toString(),
			prompt,
			createdBy,
			source,
			metadata,
		},
		entryPoints,
	);
	return incidentId.toString();
}

export async function listIncidents<E extends AuthContext>({ c }: { c: Context<E> }) {
	const clientId = c.var.auth.clientId;
	const incidents = await c.env.incidents
		.prepare("SELECT id, identifier, status, assignee, severity, createdAt, title, description FROM incident WHERE client_id = ?")
		.bind(clientId)
		.all<{
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

export async function updateSeverity<E extends BasicContext>({ c, id, severity }: { c: Context<E>; id: string; severity: IS["severity"] }) {
	const incidentId = c.env.INCIDENT.idFromString(id);
	const incident = c.env.INCIDENT.get(incidentId);
	await incident.setSeverity(severity);
}

export async function updateAssignee<E extends BasicContext>({ c, id, assignee }: { c: Context<E>; id: string; assignee: IS["assignee"] }) {
	const incidentId = c.env.INCIDENT.idFromString(id);
	const incident = c.env.INCIDENT.get(incidentId);
	await incident.setAssignee(assignee);
}

export async function updateStatus<E extends BasicContext>({ c, id, status, message }: { c: Context<E>; id: string; status: Exclude<IS["status"], "open">; message: string }) {
	const incidentId = c.env.INCIDENT.idFromString(id);
	const incident = c.env.INCIDENT.get(incidentId);
	await incident.updateStatus(status, message);
}
