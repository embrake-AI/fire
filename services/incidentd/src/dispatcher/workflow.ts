import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep, type WorkflowStepConfig } from "cloudflare:workers";
import type { IS, IS_Event } from "@fire/common";
import * as dashboardSender from "../adapters/dashboard/sender";
import * as slackSender from "../adapters/slack/sender";
import type { Metadata } from "../handler";
import { ASSERT, ASSERT_NEVER } from "../lib/utils";

export type Incident = {
	status: IS["status"];
	assignee: string;
	severity: IS["severity"];
	title: string;
	description: string;
};

export type IncidentWorkflowPayload = {
	event: IS_Event & { incident_id: string; event_id: number };
	metadata: Metadata;
	eventMetadata?: Record<string, string>;
};

export const INCIDENT_WORKFLOW_EVENT_TYPE = "incident-event";

export type StepDo = WorkflowStep["do"];

interface Sender {
	incidentStarted: ((step: StepDo, env: Env, id: string, incident: Incident, metadata: Metadata) => Promise<void>) | undefined;
	incidentSeverityUpdated: ((step: StepDo, env: Env, id: string, incident: Incident, metadata: Metadata) => Promise<void>) | undefined;
	incidentAssigneeUpdated: ((step: StepDo, env: Env, id: string, incident: Incident, metadata: Metadata) => Promise<void>) | undefined;
	incidentStatusUpdated: ((step: StepDo, env: Env, id: string, incident: Incident, message: string, metadata: Metadata) => Promise<void>) | undefined;
	messageAdded:
		| ((step: StepDo, env: Env, id: string, message: string, userId: string, messageId: string, metadata: Metadata, slackUserToken?: string) => Promise<void>)
		| undefined;
}

interface DashboardSender {
	incidentStarted: ((step: StepDo, env: Env, id: string, incident: Incident, metadata: Metadata) => Promise<Incident>) | undefined;
	incidentSeverityUpdated: ((step: StepDo, env: Env, id: string, severity: IS["severity"], metadata: Metadata) => Promise<Incident | null>) | undefined;
	incidentAssigneeUpdated: ((step: StepDo, env: Env, id: string, assignee: IS["assignee"], metadata: Metadata) => Promise<Incident | null>) | undefined;
	incidentStatusUpdated: ((step: StepDo, env: Env, id: string, status: Exclude<IS["status"], "open">, message: string, metadata: Metadata) => Promise<Incident | null>) | undefined;
	messageAdded: ((step: StepDo, env: Env, id: string, message: string, userId: string, messageId: string, metadata: Metadata) => Promise<Incident | null>) | undefined;
}

const adapters = {
	dashboard: dashboardSender as DashboardSender,
	senders: [slackSender] as Sender[],
};

function isIncidentResolved(event: IS_Event) {
	return event.event_type === "STATUS_UPDATE" && event.event_data.status === "resolved";
}

async function settleDispatch(label: string, tasks: Array<Promise<unknown> | undefined>) {
	const results = await Promise.allSettled(tasks);
	for (const result of results) {
		if (result.status === "rejected") {
			console.warn("Dispatcher task failed", { label, error: result.reason });
		}
	}
}

type Callback = <T>() => Promise<T>;
function createStepDo(step: WorkflowStep, eventId: number): StepDo {
	return ((name: string, configOrCallback: WorkflowStepConfig | Callback, callback?: Callback) => {
		const prefixedName = `${name}:${eventId}`;
		if (callback !== undefined && typeof configOrCallback !== "function") {
			return step.do(prefixedName, configOrCallback, callback);
		} else if (typeof configOrCallback === "function") {
			return step.do(prefixedName, configOrCallback);
		}
	}) as StepDo;
}

async function dispatchIncidentStartedEvent(step: StepDo, env: Env, id: string, incident: Incident, metadata: Metadata) {
	await settleDispatch("incident-started", [
		adapters.dashboard.incidentStarted?.(step, env, id, incident, metadata),
		...adapters.senders.map((sender) => sender.incidentStarted?.(step, env, id, incident, metadata)),
	]);
}

async function dispatchIncidentSeverityUpdatedEvent(step: StepDo, env: Env, id: string, severity: IS["severity"], metadata: Metadata) {
	const incident = await adapters.dashboard.incidentSeverityUpdated?.(step, env, id, severity, metadata);
	if (!incident) {
		return;
	}
	await settleDispatch("incident-severity-updated", [...adapters.senders.map((sender) => sender.incidentSeverityUpdated?.(step, env, id, incident, metadata))]);
}

async function dispatchIncidentAssigneeUpdatedEvent(step: StepDo, env: Env, id: string, assignee: IS["assignee"], metadata: Metadata) {
	const incident = await adapters.dashboard.incidentAssigneeUpdated?.(step, env, id, assignee, metadata);
	if (!incident) {
		return;
	}
	await settleDispatch("incident-assignee-updated", [...adapters.senders.map((sender) => sender.incidentAssigneeUpdated?.(step, env, id, incident, metadata))]);
}

async function dispatchIncidentStatusUpdatedEvent(step: StepDo, env: Env, id: string, status: Exclude<IS["status"], "open">, message: string, metadata: Metadata) {
	const incident = await adapters.dashboard.incidentStatusUpdated?.(step, env, id, status, message, metadata);
	if (!incident) {
		return;
	}
	await settleDispatch("incident-status-updated", [...adapters.senders.map((sender) => sender.incidentStatusUpdated?.(step, env, id, incident, message, metadata))]);
}

async function dispatchMessageAddedEvent(step: StepDo, env: Env, id: string, message: string, userId: string, messageId: string, metadata: Metadata, slackUserToken?: string) {
	const incident = await adapters.dashboard.messageAdded?.(step, env, id, message, userId, messageId, metadata);
	if (!incident) {
		return;
	}
	await settleDispatch("message-added", [...adapters.senders.map((sender) => sender.messageAdded?.(step, env, id, message, userId, messageId, metadata, slackUserToken))]);
}

async function dispatchEvent(step: WorkflowStep, env: Env, payload: IncidentWorkflowPayload) {
	const eventType = payload.event.event_type;
	const stepDo = createStepDo(step, payload.event.event_id);
	switch (eventType) {
		case "INCIDENT_CREATED": {
			const incident: Incident = {
				status: payload.event.event_data.status,
				assignee: payload.event.event_data.assignee,
				severity: payload.event.event_data.severity,
				title: payload.event.event_data.title,
				description: payload.event.event_data.description,
			};
			return dispatchIncidentStartedEvent(stepDo, env, payload.event.incident_id, incident, payload.metadata);
		}
		case "ASSIGNEE_UPDATE": {
			return dispatchIncidentAssigneeUpdatedEvent(stepDo, env, payload.event.incident_id, payload.event.event_data.assignee, payload.metadata);
		}
		case "SEVERITY_UPDATE": {
			return dispatchIncidentSeverityUpdatedEvent(stepDo, env, payload.event.incident_id, payload.event.event_data.severity, payload.metadata);
		}
		case "STATUS_UPDATE": {
			ASSERT(payload.event.event_data.status !== "open", "Incident cannot be opened from the dispatcher");
			return dispatchIncidentStatusUpdatedEvent(stepDo, env, payload.event.incident_id, payload.event.event_data.status, payload.event.event_data.message, payload.metadata);
		}
		case "MESSAGE_ADDED": {
			return dispatchMessageAddedEvent(
				stepDo,
				env,
				payload.event.incident_id,
				payload.event.event_data.message,
				payload.event.event_data.userId,
				payload.event.event_data.messageId,
				payload.metadata,
				payload.eventMetadata?.slackUserToken,
			);
		}
		default: {
			ASSERT_NEVER(eventType);
		}
	}
}

export class IncidentWorkflow extends WorkflowEntrypoint<Env, IncidentWorkflowPayload> {
	async run(event: WorkflowEvent<IncidentWorkflowPayload>, step: WorkflowStep) {
		let payload = event.payload;

		await this.dispatchWithLogging(step, payload);

		while (!isIncidentResolved(payload.event)) {
			const nextEvent = await step.waitForEvent<IncidentWorkflowPayload>(`wait-for-incident-event_${payload.event.event_id}`, {
				type: INCIDENT_WORKFLOW_EVENT_TYPE,
				timeout: "2 days",
			});
			payload = nextEvent.payload;

			await this.dispatchWithLogging(step, payload);
		}
	}

	private async dispatchWithLogging(step: WorkflowStep, payload: IncidentWorkflowPayload) {
		try {
			await dispatchEvent(step, this.env, payload);
		} catch (error) {
			console.error("Workflow dispatch failed", payload.event, error);
		}
	}
}
