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

export type SummaryResponsePayload = {
	incidentId: string;
	description: string;
	channel: string;
	threadTs?: string;
	ts: string;
	adapter: "slack" | "dashboard";
};

export type IncidentWorkflowPayload =
	| {
			kind: "event";
			event: IS_Event & { incident_id: string; event_id: number };
			incident: Incident;
			metadata: Metadata;
			adapter: "slack" | "dashboard";
			eventMetadata?: Record<string, string>;
	  }
	| {
			kind: "summary_response";
			summary_response: SummaryResponsePayload;
			incident: Incident;
			metadata: Metadata;
			adapter: "slack" | "dashboard";
	  };

export const INCIDENT_WORKFLOW_EVENT_TYPE = "incident-event";

export type StepDo = WorkflowStep["do"];

export type SenderParams = {
	incidentStarted: {
		step: StepDo;
		env: Env;
		id: string;
		incident: Incident;
		metadata: Metadata;
		sourceAdapter: "slack" | "dashboard";
	};
	incidentSeverityUpdated: {
		step: StepDo;
		env: Env;
		id: string;
		incident: Incident;
		metadata: Metadata;
		sourceAdapter: "slack" | "dashboard";
		eventMetadata?: Record<string, string>;
	};
	incidentAssigneeUpdated: {
		step: StepDo;
		env: Env;
		id: string;
		incident: Incident;
		metadata: Metadata;
		sourceAdapter: "slack" | "dashboard";
	};
	incidentStatusUpdated: {
		step: StepDo;
		env: Env;
		id: string;
		incident: Incident;
		message: string;
		metadata: Metadata;
		sourceAdapter: "slack" | "dashboard";
		eventMetadata?: Record<string, string>;
	};
	messageAdded: {
		step: StepDo;
		env: Env;
		id: string;
		message: string;
		userId: string;
		messageId: string;
		metadata: Metadata;
		sourceAdapter: "slack" | "dashboard";
		slackUserToken?: string;
	};
	summaryResponse: {
		step: StepDo;
		env: Env;
		id: string;
		incident: Incident;
		description: string;
		channel: string;
		threadTs?: string;
		ts: string;
		metadata: Metadata;
		sourceAdapter: "slack" | "dashboard";
	};
};

interface Sender {
	incidentStarted: ((params: SenderParams["incidentStarted"]) => Promise<void>) | undefined;
	incidentSeverityUpdated: ((params: SenderParams["incidentSeverityUpdated"]) => Promise<void>) | undefined;
	incidentAssigneeUpdated: ((params: SenderParams["incidentAssigneeUpdated"]) => Promise<void>) | undefined;
	incidentStatusUpdated: ((params: SenderParams["incidentStatusUpdated"]) => Promise<void>) | undefined;
	messageAdded: ((params: SenderParams["messageAdded"]) => Promise<void>) | undefined;
	summaryResponse: ((params: SenderParams["summaryResponse"]) => Promise<void>) | undefined;
}

const senders: Sender[] = [dashboardSender, slackSender];

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
function createStepDo(step: WorkflowStep, eventId: number | string): StepDo {
	return ((name: string, configOrCallback: WorkflowStepConfig | Callback, callback?: Callback) => {
		const prefixedName = `${name}:${String(eventId)}`;
		if (callback !== undefined && typeof configOrCallback !== "function") {
			return step.do(prefixedName, configOrCallback, callback);
		} else if (typeof configOrCallback === "function") {
			return step.do(prefixedName, configOrCallback);
		}
	}) as StepDo;
}

async function dispatchIncidentStartedEvent(params: SenderParams["incidentStarted"]) {
	const { step, env, id, incident, metadata, sourceAdapter } = params;
	const payload = { step, env, id, incident, metadata, sourceAdapter };
	await settleDispatch("incident-started.dashboard-first", [dashboardSender.incidentStarted?.(payload)]);
	const otherSenders = senders.filter((sender) => sender !== dashboardSender);
	await settleDispatch("incident-started", [...otherSenders.map((sender) => sender.incidentStarted?.(payload))]);
}

async function dispatchIncidentSeverityUpdatedEvent(params: SenderParams["incidentSeverityUpdated"]) {
	await settleDispatch("incident-severity-updated", [...senders.map((sender) => sender.incidentSeverityUpdated?.(params))]);
}

async function dispatchIncidentAssigneeUpdatedEvent(params: SenderParams["incidentAssigneeUpdated"]) {
	await settleDispatch("incident-assignee-updated", [...senders.map((sender) => sender.incidentAssigneeUpdated?.(params))]);
}

async function dispatchIncidentStatusUpdatedEvent(params: SenderParams["incidentStatusUpdated"]) {
	await settleDispatch("incident-status-updated", [...senders.map((sender) => sender.incidentStatusUpdated?.(params))]);
}

async function dispatchMessageAddedEvent(params: SenderParams["messageAdded"]) {
	await settleDispatch("message-added", [...senders.map((sender) => sender.messageAdded?.(params))]);
}

async function dispatchSummaryResponseEvent(params: SenderParams["summaryResponse"]) {
	await settleDispatch("summary-response", [...senders.map((sender) => sender.summaryResponse?.(params))]);
}

type WorkflowEventPayload = Extract<IncidentWorkflowPayload, { kind: "event" }>;
type SummaryResponseEventPayload = Extract<IncidentWorkflowPayload, { kind: "summary_response" }>;

async function dispatchEvent(step: WorkflowStep, env: Env, payload: WorkflowEventPayload) {
	const eventType = payload.event.event_type;
	const stepDo = createStepDo(step, payload.event.event_id);
	const baseParams = { step: stepDo, env, id: payload.event.incident_id, incident: payload.incident, metadata: payload.metadata, sourceAdapter: payload.adapter };
	switch (eventType) {
		case "INCIDENT_CREATED": {
			return dispatchIncidentStartedEvent(baseParams);
		}
		case "ASSIGNEE_UPDATE": {
			return dispatchIncidentAssigneeUpdatedEvent(baseParams);
		}
		case "SEVERITY_UPDATE": {
			return dispatchIncidentSeverityUpdatedEvent({ ...baseParams, eventMetadata: payload.eventMetadata });
		}
		case "STATUS_UPDATE": {
			ASSERT(payload.event.event_data.status !== "open", "Incident cannot be opened from the dispatcher");
			return dispatchIncidentStatusUpdatedEvent({ ...baseParams, message: payload.event.event_data.message, eventMetadata: payload.eventMetadata });
		}
		case "MESSAGE_ADDED": {
			return dispatchMessageAddedEvent({
				...baseParams,
				message: payload.event.event_data.message,
				userId: payload.event.event_data.userId,
				messageId: payload.event.event_data.messageId,
				slackUserToken: payload.eventMetadata?.slackUserToken,
			});
		}
		default: {
			ASSERT_NEVER(eventType);
		}
	}
}

async function dispatchSummaryResponse(step: WorkflowStep, env: Env, payload: SummaryResponseEventPayload) {
	const stepDo = createStepDo(step, payload.summary_response.ts);
	await dispatchSummaryResponseEvent({
		step: stepDo,
		env,
		id: payload.summary_response.incidentId,
		incident: payload.incident,
		description: payload.summary_response.description,
		channel: payload.summary_response.channel,
		threadTs: payload.summary_response.threadTs,
		ts: payload.summary_response.ts,
		metadata: payload.metadata,
		sourceAdapter: payload.summary_response.adapter,
	});
}

export class IncidentWorkflow extends WorkflowEntrypoint<Env, IncidentWorkflowPayload> {
	async run(event: WorkflowEvent<IncidentWorkflowPayload>, step: WorkflowStep) {
		let payload = event.payload;
		let lastEvent = payload.kind === "event" ? payload.event : undefined;
		let waitKey = payload.kind === "event" ? payload.event.event_id : payload.summary_response.ts;

		await this.dispatchWithLogging(step, payload);

		while (!lastEvent || !isIncidentResolved(lastEvent)) {
			const nextEvent = await step.waitForEvent<IncidentWorkflowPayload>(`wait-for-incident-event_${String(waitKey)}`, {
				type: INCIDENT_WORKFLOW_EVENT_TYPE,
				timeout: "2 days",
			});
			payload = nextEvent.payload;
			if (payload.kind === "event") {
				lastEvent = payload.event;
			}
			waitKey = payload.kind === "event" ? payload.event.event_id : payload.summary_response.ts;

			await this.dispatchWithLogging(step, payload);
		}
	}

	private async dispatchWithLogging(step: WorkflowStep, payload: IncidentWorkflowPayload) {
		try {
			if (payload.kind === "event") {
				await dispatchEvent(step, this.env, payload);
			} else {
				await dispatchSummaryResponse(step, this.env, payload);
			}
		} catch (error) {
			console.error("Workflow dispatch failed", payload, error);
		}
	}
}
