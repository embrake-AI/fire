import type { EntryPoint, IS, IS_Event, ListIncidentsElement } from "@fire/common";
import type { Context } from "hono";

export type BasicContext = { Bindings: Env };
export type AuthContext = BasicContext & { Variables: { auth: { clientId: string } } };
export type Metadata = Record<string, string> & { clientId: string; identifier: string };
type BootstrapMessage = { message: string; userId: string; messageId: string; createdAt: string };

// identifier -> idFromName
// id -> idFromString

export async function startIncident<E extends AuthContext>({
	c,
	m,
	prompt,
	createdBy,
	source,
	identifier,
	entryPoints,
	services,
	bootstrapMessages,
}: {
	c: Context<E>;
	m: Omit<Metadata, "clientId">;
	identifier: string;
	entryPoints: EntryPoint[];
	services: { id: string; name: string; prompt: string | null }[];
	bootstrapMessages?: BootstrapMessage[];
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
		services,
		bootstrapMessages,
	);
	return incidentId.toString();
}

export async function listIncidents<E extends AuthContext>({ c }: { c: Context<E> }) {
	const clientId = c.var.auth.clientId;
	const incidents = await c.env.incidents
		.prepare("SELECT id, status, assignee, severity, createdAt, title, description FROM incident WHERE client_id = ?")
		.bind(clientId)
		.all<ListIncidentsElement>();
	return incidents.results;
}

export async function getIncident<E extends BasicContext>({ c, id }: { c: Context<E>; id: string }) {
	const incidentId = c.env.INCIDENT.idFromString(id);
	const incident = c.env.INCIDENT.get(incidentId);
	return incident.get();
}

export async function updateSeverity<E extends BasicContext>({
	c,
	id,
	severity,
	adapter,
	eventMetadata,
}: {
	c: Context<E>;
	id: string;
	severity: IS["severity"];
	adapter: "slack" | "dashboard" | "fire";
	eventMetadata?: Record<string, string>;
}) {
	const incidentId = c.env.INCIDENT.idFromString(id);
	const incident = c.env.INCIDENT.get(incidentId);
	return incident.setSeverity(severity, adapter, eventMetadata);
}

export async function updateAssignee<E extends BasicContext>({
	c,
	id,
	assignee,
	adapter,
}: {
	c: Context<E>;
	id: string;
	assignee: IS["assignee"];
	adapter: "slack" | "dashboard" | "fire";
}) {
	const incidentId = c.env.INCIDENT.idFromString(id);
	const incident = c.env.INCIDENT.get(incidentId);
	return incident.setAssignee(assignee, adapter);
}

export async function updateStatus<E extends BasicContext>({
	c,
	id,
	status,
	message,
	adapter,
	eventMetadata,
}: {
	c: Context<E>;
	id: string;
	status: Exclude<IS["status"], "open">;
	message: string;
	adapter: "slack" | "dashboard" | "fire";
	eventMetadata?: Record<string, string>;
}) {
	const incidentId = c.env.INCIDENT.idFromString(id);
	const incident = c.env.INCIDENT.get(incidentId);
	return incident.updateStatus(status, message, adapter, eventMetadata);
}

export async function updateAffection<E extends BasicContext>({
	c,
	id,
	update,
	adapter,
	eventMetadata,
}: {
	c: Context<E>;
	id: string;
	update: Extract<IS_Event, { event_type: "AFFECTION_UPDATE" }>["event_data"];
	adapter: "slack" | "dashboard" | "fire";
	eventMetadata?: Record<string, string>;
}) {
	const incidentId = c.env.INCIDENT.idFromString(id);
	const incident = c.env.INCIDENT.get(incidentId);
	return incident.updateAffection({ ...update, adapter, eventMetadata });
}

export async function addMessage<E extends BasicContext>({
	c,
	identifier,
	id,
	message,
	userId,
	messageId,
	adapter,
	slackUserToken,
	eventMetadata,
}: {
	c: Context<E>;
	message: string;
	userId: string;
	messageId: string;
	adapter: "slack" | "dashboard" | "fire";
	slackUserToken?: string;
	eventMetadata?: Record<string, string>;
} & ({ identifier: string; id?: never } | { id: string; identifier?: never })) {
	const incidentId = id ? c.env.INCIDENT.idFromString(id) : c.env.INCIDENT.idFromName(identifier!);
	const incident = c.env.INCIDENT.get(incidentId);
	await incident.addMessage(message, userId, messageId, adapter, slackUserToken, eventMetadata);
}

export async function addPrompt<E extends BasicContext>({
	c,
	identifier,
	id,
	prompt,
	userId,
	ts,
	channel,
	threadTs,
	adapter,
}: {
	c: Context<E>;
	prompt: string;
	userId: string;
	ts: string;
	channel: string;
	threadTs?: string;
	adapter: "slack" | "dashboard" | "fire";
} & ({ identifier: string; id?: never } | { id: string; identifier?: never })) {
	const incidentId = id ? c.env.INCIDENT.idFromString(id) : c.env.INCIDENT.idFromName(identifier!);
	const safeTs = ts.replaceAll(".", "-");
	const workflowId = `prompt-${channel.toLowerCase()}-${safeTs}`;
	await c.env.INCIDENT_PROMPT_WORKFLOW.create({
		id: workflowId,
		params: {
			incidentId: incidentId.toString(),
			prompt,
			userId,
			ts,
			channel,
			threadTs,
			adapter,
		},
	});
}
