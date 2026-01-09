import type { IS } from "@fire/common";
import type { Incident, StepDo } from "../../../dispatcher/workflow";
import type { Metadata } from "../../../handler";

export async function incidentStarted(stepDo: StepDo, env: Env, id: string, incident: Incident, metadata: Metadata): Promise<Incident> {
	const { assignee, severity, title, description, status } = incident;
	const { clientId, identifier } = metadata;
	await stepDo("d1.incident.insert", async () => {
		await env.incidents
			.prepare("INSERT INTO incident (id, identifier, status, assignee, severity, title, description, client_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING")
			.bind(id, identifier, status, assignee, severity, title, description, clientId)
			.run();
		return true;
	});
	return incident;
}

export async function incidentSeverityUpdated(stepDo: StepDo, env: Env, id: string, severity: IS["severity"], _metadata: Metadata): Promise<Incident | null> {
	return stepDo("d1.incident.update-severity", async () =>
		env.incidents.prepare("UPDATE incident SET severity = ? WHERE id = ? RETURNING status, assignee, severity, title, description").bind(severity, id).first<Incident>(),
	);
}

export async function incidentAssigneeUpdated(stepDo: StepDo, env: Env, id: string, assignee: IS["assignee"], _metadata: Metadata): Promise<Incident | null> {
	return stepDo("d1.incident.update-assignee", async () =>
		env.incidents.prepare("UPDATE incident SET assignee = ? WHERE id = ? RETURNING status, assignee, severity, title, description").bind(assignee.slackId, id).first<Incident>(),
	);
}

export async function incidentStatusUpdated(
	stepDo: StepDo,
	env: Env,
	id: string,
	status: Exclude<IS["status"], "open">,
	_message: string,
	_metadata: Metadata,
): Promise<Incident | null> {
	const incident = await stepDo("d1.incident.update-status", async () =>
		env.incidents.prepare("UPDATE incident SET status = ? WHERE id = ? RETURNING status, assignee, severity, title, description").bind(status, id).first<Incident>(),
	);
	if (!incident) {
		return null;
	}
	if (status === "resolved") {
		await stepDo("d1.incident.delete", async () => {
			await env.incidents.prepare("DELETE FROM incident WHERE id = ?").bind(id).run();
			return true;
		});
	}
	return incident;
}

export async function messageAdded(stepDo: StepDo, env: Env, id: string, _message: string, _userId: string, _messageId: string, _metadata: Metadata): Promise<Incident | null> {
	return stepDo("d1.incident.select", async () =>
		env.incidents.prepare("SELECT status, assignee, severity, title, description FROM incident WHERE id = ?").bind(id).first<Incident>(),
	);
}
