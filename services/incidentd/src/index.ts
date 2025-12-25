import { WorkerEntrypoint } from "cloudflare:workers";
import type { IS_Event } from "@fire/common";
import { Hono } from "hono";
import { dashboardRoutes } from "./adapters/dashboard/receiver/routes";
import { slackRoutes } from "./adapters/slack/receiver/routes";
import type { DOState } from "./core/incident";
import { dispatchIncidentAssigneeUpdatedEvent, dispatchIncidentSeverityUpdatedEvent, dispatchIncidentStartedEvent, dispatchIncidentStatusUpdatedEvent } from "./dispatcher";
import { ASSERT, ASSERT_NEVER } from "./lib/utils";

export { Incident } from "./core/incident";

const app = new Hono<{ Bindings: Env }>();

app.route("/slack", slackRoutes);
app.route("/dashboard", dashboardRoutes);

export default class incidentd extends WorkerEntrypoint<Env> {
	fetch = (request: Request) => app.fetch(request, this.env, this.ctx);
	async dispatch(event: IS_Event & { incident_id: string; event_id: number }, state: DOState) {
		const eventType = event.event_type;
		switch (eventType) {
			case "INCIDENT_CREATED": {
				return dispatchIncidentStartedEvent(this.env, state);
			}
			case "ASSIGNEE_UPDATE": {
				return dispatchIncidentAssigneeUpdatedEvent(this.env, event.event_data.assignee, state);
			}
			case "SEVERITY_UPDATE": {
				return dispatchIncidentSeverityUpdatedEvent(this.env, event.event_data.severity, state);
			}
			case "STATUS_UPDATE": {
				ASSERT(event.event_data.status !== "open", "Incident cannot be opened from the dispatcher");
				return dispatchIncidentStatusUpdatedEvent(this.env, event.event_data.status, event.event_data.message, state);
			}
			default: {
				ASSERT_NEVER(eventType);
			}
		}
	}
}
