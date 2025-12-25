/**
 * This will consume messages from the queue which are posted by the Incident Durable Object.
 * Right now, we avoid the queue as it's on the worker's paid plan, and make the dispatcher call the sender directly.
 * This makes it possible that there is inconsistency between the incident state and the actual communication sent out.
 */

import type { IS } from "@fire/common";
import * as slackSender from "../adapters/slack/sender";
import type { DOState } from "../core/incident";

interface Sender {
	incidentStarted: ((env: Env, incident: DOState) => Promise<void>) | undefined;
	incidentSeverityUpdated: ((env: Env, newSeverity: IS["severity"], incident: DOState) => Promise<void>) | undefined;
	incidentAssigneeUpdated: ((env: Env, newAssignee: string, incident: DOState) => Promise<void>) | undefined;
	incidentStatusUpdated: ((env: Env, newStatus: Exclude<IS["status"], "open">, message: string, incident: DOState) => Promise<void>) | undefined;
}

const senders: Sender[] = [slackSender];

export async function dispatchIncidentStartedEvent(env: Env, incident: DOState) {
	const { id, metadata, assignee, severity, title, description } = incident;
	const { clientId, identifier } = metadata;
	await Promise.all([
		env.incidents
			.prepare("INSERT INTO incident (id, identifier, status, assignee, severity, title, description, client_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING")
			.bind(id, identifier, "open", assignee, severity, title, description, clientId)
			.run(),
		...senders.map((sender) => sender.incidentStarted?.(env, incident)),
	]);
}

export async function dispatchIncidentSeverityUpdatedEvent(env: Env, newSeverity: IS["severity"], incident: DOState) {
	const { id, severity } = incident;
	await Promise.all([
		env.incidents.prepare("UPDATE incident SET severity = ? WHERE id = ?").bind(severity, id).run(),
		...senders.map((sender) => sender.incidentSeverityUpdated?.(env, newSeverity, incident)),
	]);
}

export async function dispatchIncidentAssigneeUpdatedEvent(env: Env, newAssignee: string, incident: DOState) {
	const { id, assignee } = incident;
	await Promise.all([
		env.incidents.prepare("UPDATE incident SET assignee = ? WHERE id = ?").bind(assignee, id).run(),
		...senders.map((sender) => sender.incidentAssigneeUpdated?.(env, newAssignee, incident)),
	]);
}

export async function dispatchIncidentStatusUpdatedEvent(env: Env, newStatus: Exclude<IS["status"], "open">, message: string, incident: DOState) {
	const { id } = incident;

	const dbOperation =
		newStatus === "resolved"
			? env.incidents.prepare("DELETE FROM incident WHERE id = ?").bind(id).run()
			: env.incidents.prepare("UPDATE incident SET status = ? WHERE id = ?").bind(newStatus, id).run();

	await Promise.all([dbOperation, ...senders.map((sender) => sender.incidentStatusUpdated?.(env, newStatus, message, incident))]);
}
