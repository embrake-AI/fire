import type { IS } from "@fire/common";
import * as slackSender from "../adapters/slack/sender";
import type { Metadata } from "../handler";

export type Incident = {
	status: IS["status"];
	assignee: string;
	severity: IS["severity"];
	title: string;
	description: string;
};

interface Sender {
	incidentStarted: ((env: Env, id: string, incident: Incident, metadata: Metadata) => Promise<void>) | undefined;
	incidentSeverityUpdated: ((env: Env, id: string, incident: Incident, metadata: Metadata) => Promise<void>) | undefined;
	incidentAssigneeUpdated: ((env: Env, id: string, incident: Incident, metadata: Metadata) => Promise<void>) | undefined;
	incidentStatusUpdated: ((env: Env, id: string, incident: Incident, message: string, metadata: Metadata) => Promise<void>) | undefined;
}

const senders: Sender[] = [slackSender];

export async function dispatchIncidentStartedEvent(env: Env, id: string, incident: Incident, metadata: Metadata) {
	const { assignee, severity, title, description } = incident;
	const { clientId, identifier } = metadata;
	await Promise.all([
		env.incidents
			.prepare("INSERT INTO incident (id, identifier, status, assignee, severity, title, description, client_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING")
			.bind(id, identifier, "open", assignee, severity, title, description, clientId)
			.run(),
		...senders.map((sender) => sender.incidentStarted?.(env, id, incident, metadata)),
	]);
}

export async function dispatchIncidentSeverityUpdatedEvent(env: Env, id: string, severity: IS["severity"], metadata: Metadata) {
	const incident = await env.incidents
		.prepare("UPDATE incident SET severity = ? WHERE id = ? RETURNING status, assignee, severity, title, description")
		.bind(severity, id)
		.first<Incident>();
	if (!incident) {
		return;
	}
	await Promise.all([...senders.map((sender) => sender.incidentSeverityUpdated?.(env, id, incident, metadata))]);
}

export async function dispatchIncidentAssigneeUpdatedEvent(env: Env, id: string, assignee: string, metadata: Metadata) {
	const incident = await env.incidents
		.prepare("UPDATE incident SET assignee = ? WHERE id = ? RETURNING status, assignee, severity, title, description")
		.bind(assignee, id)
		.first<Incident>();
	if (!incident) {
		return;
	}
	await Promise.all([...senders.map((sender) => sender.incidentAssigneeUpdated?.(env, id, incident, metadata))]);
}

export async function dispatchIncidentStatusUpdatedEvent(env: Env, id: string, status: Exclude<IS["status"], "open">, message: string, metadata: Metadata) {
	const incident =
		status === "resolved"
			? await env.incidents.prepare("DELETE FROM incident WHERE id = ? RETURNING status, assignee, severity, title, description").bind(id).first<Incident>()
			: await env.incidents.prepare("UPDATE incident SET status = ? WHERE id = ? RETURNING status, assignee, severity, title, description").bind(status, id).first<Incident>();
	if (!incident) {
		return;
	}
	await Promise.all([...senders.map((sender) => sender.incidentStatusUpdated?.(env, id, incident, message, metadata))]);
}
