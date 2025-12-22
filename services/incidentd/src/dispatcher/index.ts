/**
 * This will consume messages from the queue which are posted by the Incident Durable Object.
 * Right now, we avoid the queue as it's on the worker's paid plan, and make the dispatcher call the sender directly.
 * This makes it possible that there is inconsistency between the incident state and the actual communication sent out.
 */

import type { Context } from "hono";
import * as slackSender from "../adapters/slack/sender";
import type { DOState } from "../core/incident";
import type { BasicContext } from "../handler";

interface Sender {
	incidentStarted: (<E extends BasicContext>(c: Context<E>, incident: DOState) => Promise<void>) | undefined;
	incidentSeverityUpdated: (<E extends BasicContext>(c: Context<E>, newSeverity: string, incident: DOState) => Promise<void>) | undefined;
	incidentAssigneeUpdated: (<E extends BasicContext>(c: Context<E>, newAssignee: string, incident: DOState) => Promise<void>) | undefined;
}

const senders: Sender[] = [slackSender];

export async function dispatchIncidentStartedEvent<E extends BasicContext>(c: Context<E>, incident: DOState) {
	const { id, metadata, assignee, severity, title, description } = incident;
	const { clientId, identifier } = metadata;
	console.log("TODO: use clientId to send the event to the client", clientId);
	await Promise.all([
		c.env.incidents
			.prepare("INSERT INTO incident (id, identifier, status, assignee, severity, title, description) VALUES (?, ?, ?, ?, ?, ?, ?)")
			.bind(id, identifier, "open", assignee, severity, title, description)
			.run(),
		...senders.map((sender) => sender.incidentStarted?.(c, incident)),
	]);
}

export async function dispatchIncidentSeverityUpdatedEvent<E extends BasicContext>(c: Context<E>, newSeverity: string, incident: DOState) {
	const { id, severity } = incident;
	await Promise.all([
		c.env.incidents.prepare("UPDATE incident SET severity = ? WHERE id = ?").bind(severity, id).run(),
		...senders.map((sender) => sender.incidentSeverityUpdated?.(c, newSeverity, incident)),
	]);
}

export async function dispatchIncidentAssigneeUpdatedEvent<E extends BasicContext>(c: Context<E>, newAssignee: string, incident: DOState) {
	const { id, assignee } = incident;
	await Promise.all([
		c.env.incidents.prepare("UPDATE incident SET assignee = ? WHERE id = ?").bind(assignee, id).run(),
		...senders.map((sender) => sender.incidentAssigneeUpdated?.(c, newAssignee, incident)),
	]);
}
