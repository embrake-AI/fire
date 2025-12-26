import { WorkerEntrypoint } from "cloudflare:workers";
import type { IS_Event } from "@fire/common";
import { Hono } from "hono";
import { dashboardRoutes } from "./adapters/dashboard/receiver/routes";
import { slackRoutes } from "./adapters/slack/receiver/routes";
import {
	dispatchIncidentAssigneeUpdatedEvent,
	dispatchIncidentSeverityUpdatedEvent,
	dispatchIncidentStartedEvent,
	dispatchIncidentStatusUpdatedEvent,
	dispatchMessageAddedEvent,
} from "./dispatcher";
import type { Metadata } from "./handler";
import { ASSERT, ASSERT_NEVER } from "./lib/utils";

export { Incident } from "./core/incident";

const app = new Hono<{ Bindings: Env }>();

app.route("/slack", slackRoutes);
app.route("/dashboard", dashboardRoutes);

export default class incidentd extends WorkerEntrypoint<Env> {
	fetch = (request: Request) => app.fetch(request, this.env, this.ctx);
	async dispatch(event: IS_Event & { incident_id: string; event_id: number }, metadata: Metadata) {
		const eventType = event.event_type;
		switch (eventType) {
			case "INCIDENT_CREATED": {
				return dispatchIncidentStartedEvent(this.env, event.incident_id, event.event_data, metadata);
			}
			case "ASSIGNEE_UPDATE": {
				return dispatchIncidentAssigneeUpdatedEvent(this.env, event.incident_id, event.event_data.assignee, metadata);
			}
			case "SEVERITY_UPDATE": {
				return dispatchIncidentSeverityUpdatedEvent(this.env, event.incident_id, event.event_data.severity, metadata);
			}
			case "STATUS_UPDATE": {
				ASSERT(event.event_data.status !== "open", "Incident cannot be opened from the dispatcher");
				return dispatchIncidentStatusUpdatedEvent(this.env, event.incident_id, event.event_data.status, event.event_data.message, metadata);
			}
			case "MESSAGE_ADDED": {
				return dispatchMessageAddedEvent(this.env, event.incident_id, event.event_data.message, event.event_data.userId, event.event_data.messageId, metadata);
			}
			default: {
				ASSERT_NEVER(eventType);
			}
		}
	}
}
