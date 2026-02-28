import type { SenderParams } from "../../../dispatcher/workflow";

function buildIncidentIdentifiers(metadata: Record<string, string> & { identifier: string }): string[] {
	return [metadata.identifier];
}

export async function addIncidentIdentifiers({
	step,
	env,
	id,
	identifiers,
}: {
	step: SenderParams["incidentStarted"]["step"];
	env: Env;
	id: string;
	identifiers: string[];
}): Promise<void> {
	const normalized = Array.from(new Set(identifiers.filter((identifier) => identifier)));
	if (!normalized.length) {
		return;
	}
	await step("d1.incident.add-identifiers", async () => {
		const valuesClause = normalized.map(() => "(?)").join(", ");
		const statement = `
			WITH incoming(value) AS (VALUES ${valuesClause})
			UPDATE incident
			SET identifier = (
				SELECT json_group_array(value)
				FROM (
					SELECT value FROM json_each(identifier)
					UNION
					SELECT value FROM incoming
				)
			)
			WHERE id = ?
		`;
		await env.incidents
			.prepare(statement)
			.bind(...normalized, id)
			.run();
		return true;
	});
}

export async function incidentStarted(params: SenderParams["incidentStarted"]): Promise<void> {
	const { step, env, id, incident, metadata } = params;
	const { assignee, severity, title, description, status } = incident;
	const { clientId } = metadata;
	const identifiers = buildIncidentIdentifiers(metadata);
	await step("d1.incident.insert", async () => {
		await env.incidents
			.prepare("INSERT INTO incident (id, identifier, status, assignee, severity, title, description, client_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING")
			.bind(id, JSON.stringify(identifiers), status, assignee, severity, title, description, clientId)
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
	if (incident.status === "resolved" || incident.status === "declined") {
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
export const affectionUpdated = undefined;
export const similarIncident = undefined;
