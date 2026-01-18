import type { EntryPoint, IS, ListIncidentsElement } from "@fire/common";
import type { Context } from "hono";
import { decidePromptAction } from "../core/idontknowhowtonamethisitswhereillplacecallstoai";

function getValidStatusTransitions(currentStatus: IS["status"]): Array<Exclude<IS["status"], "open">> {
	switch (currentStatus) {
		case "open":
			return ["mitigating", "resolved"];
		case "mitigating":
			return ["resolved"];
		case "resolved":
			return [];
	}
}

export type BasicContext = { Bindings: Env };
export type AuthContext = BasicContext & { Variables: { auth: { clientId: string } } };
export type Metadata = Record<string, string> & { clientId: string; identifier: string };

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
}: {
	c: Context<E>;
	id: string;
	severity: IS["severity"];
	adapter: "slack" | "dashboard";
}) {
	const incidentId = c.env.INCIDENT.idFromString(id);
	const incident = c.env.INCIDENT.get(incidentId);
	await incident.setSeverity(severity, adapter);
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
	adapter: "slack" | "dashboard";
}) {
	const incidentId = c.env.INCIDENT.idFromString(id);
	const incident = c.env.INCIDENT.get(incidentId);
	await incident.setAssignee(assignee, adapter);
}

export async function updateStatus<E extends BasicContext>({
	c,
	id,
	status,
	message,
	adapter,
}: {
	c: Context<E>;
	id: string;
	status: Exclude<IS["status"], "open">;
	message: string;
	adapter: "slack" | "dashboard";
}) {
	const incidentId = c.env.INCIDENT.idFromString(id);
	const incident = c.env.INCIDENT.get(incidentId);
	await incident.updateStatus(status, message, adapter);
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
}: {
	c: Context<E>;
	message: string;
	userId: string;
	messageId: string;
	adapter: "slack" | "dashboard";
	slackUserToken?: string;
} & ({ identifier: string; id?: never } | { id: string; identifier?: never })) {
	const incidentId = id ? c.env.INCIDENT.idFromString(id) : c.env.INCIDENT.idFromName(identifier!);
	const incident = c.env.INCIDENT.get(incidentId);
	await incident.addMessage(message, userId, messageId, adapter, slackUserToken);
}

export async function addPrompt<E extends BasicContext>({
	c,
	identifier,
	id,
	prompt,
	userId: _userId,
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
	adapter: "slack" | "dashboard";
} & ({ identifier: string; id?: never } | { id: string; identifier?: never })) {
	const incidentId = id ? c.env.INCIDENT.idFromString(id) : c.env.INCIDENT.idFromName(identifier!);
	const incident = c.env.INCIDENT.get(incidentId);
	const incidentInfo = await incident.get();
	if ("error" in incidentInfo || !("state" in incidentInfo)) {
		return;
	}

	const validStatusTransitions = getValidStatusTransitions(incidentInfo.state.status);
	const decision = await decidePromptAction(
		{
			prompt,
			incident: {
				status: incidentInfo.state.status,
				severity: incidentInfo.state.severity,
				title: incidentInfo.state.title,
			},
			validStatusTransitions,
		},
		c.env.OPENAI_API_KEY,
	);

	// TODO: Handle decision noop, should change to answer user

	if (decision.action === "update_status") {
		const status = decision.status;
		if (!status || !validStatusTransitions.includes(status)) {
			return;
		}
		await incident.updateStatus(status, decision.message ?? prompt, adapter);
		return;
	}

	if (decision.action === "update_severity") {
		const severity = decision.severity;
		if (!severity) {
			return;
		}
		await incident.setSeverity(severity, adapter);
		return;
	}

	if (decision.action === "summarize") {
		await incident.respondSummary({ ts, adapter, channel, threadTs });
		return;
	}
}
