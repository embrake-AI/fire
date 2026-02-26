import type { EventLog } from "@fire/common";
import type { IncidentEventData } from "@fire/db/schema";
import type { AgentEvent } from "../../agent/types";

export type AgentEventRow = Pick<EventLog, "id" | "event_type" | "event_data" | "created_at" | "adapter" | "event_metadata">;
export type AnalysisEventRow = Pick<EventLog, "id" | "event_type" | "event_data" | "adapter" | "created_at">;

export function mapAgentEventRow(event: AgentEventRow): AgentEvent {
	return {
		id: event.id,
		event_type: event.event_type,
		event_data: JSON.parse(event.event_data),
		created_at: event.created_at,
		adapter: event.adapter,
		event_metadata: event.event_metadata ? JSON.parse(event.event_metadata) : null,
	};
}

export function mapAnalysisEventRow(event: AnalysisEventRow): IncidentEventData {
	return {
		id: event.id,
		event_type: event.event_type,
		event_data: JSON.parse(event.event_data),
		adapter: event.adapter,
		created_at: event.created_at,
	};
}
