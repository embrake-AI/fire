import type { SenderParams } from "../../../dispatcher/workflow";

export async function incidentStarted(params: SenderParams["incidentStarted"]): Promise<void> {
	const { step, env, id, incident, metadata } = params;
	const { assignee, severity, title, description, status } = incident;
	const { clientId, identifier } = metadata;
	await step("d1.incident.insert", async () => {
		await env.incidents
			.prepare("INSERT INTO incident (id, identifier, status, assignee, severity, title, description, client_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING")
			.bind(id, identifier, status, assignee, severity, title, description, clientId)
			.run();
		return true;
	});
}

export async function incidentSeverityUpdated(params: SenderParams["incidentSeverityUpdated"]): Promise<void> {
	const { step, env, id, incident } = params;
	await step("d1.incident.update-severity", async () => {
		await env.incidents.prepare("UPDATE incident SET severity = ? WHERE id = ?").bind(incident.severity, id).run();
		return true;
	});
}

export async function incidentAssigneeUpdated(params: SenderParams["incidentAssigneeUpdated"]): Promise<void> {
	const { step, env, id, incident } = params;
	await step("d1.incident.update-assignee", async () => {
		await env.incidents.prepare("UPDATE incident SET assignee = ? WHERE id = ?").bind(incident.assignee, id).run();
		return true;
	});
}

export async function incidentStatusUpdated(params: SenderParams["incidentStatusUpdated"]): Promise<void> {
	const { step, env, id, incident } = params;
	if (incident.status === "resolved") {
		await step("d1.incident.delete", async () => {
			await env.incidents.prepare("DELETE FROM incident WHERE id = ?").bind(id).run();
			return true;
		});
	} else {
		await step("d1.incident.update-status", async () => {
			await env.incidents.prepare("UPDATE incident SET status = ? WHERE id = ?").bind(incident.status, id).run();
			return true;
		});
	}
}

export const messageAdded = undefined;
