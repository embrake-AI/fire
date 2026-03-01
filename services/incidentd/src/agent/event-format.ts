import { truncate } from "@fire/common";
import type { AgentEvent } from "./types";

function formatSuggestionPayload(value: Record<string, unknown>) {
	const action = typeof value.action === "string" ? value.action : "unknown";
	if (action === "update_status") {
		const status = typeof value.status === "string" ? value.status : "unknown";
		const message = typeof value.message === "string" ? truncate(value.message, 120) : "";
		return `action=update_status status=${status}${message ? ` message="${message}"` : ""}`;
	}
	if (action === "update_severity") {
		const severity = typeof value.severity === "string" ? value.severity : "unknown";
		return `action=update_severity severity=${severity}`;
	}
	if (action === "add_status_page_update") {
		const status = typeof value.affectionStatus === "string" ? value.affectionStatus : "update";
		const message = typeof value.message === "string" ? truncate(value.message, 120) : "";
		return `action=add_status_page_update status=${status}${message ? ` message="${message}"` : ""}`;
	}
	return `action=${action}`;
}

function formatSimilarIncidentEvent(event: AgentEvent) {
	const data = event.event_data as {
		similarIncidentId?: string;
		title?: string;
		similarities?: string;
		learnings?: string;
	};
	const id = data.similarIncidentId ?? "unknown";
	const title = data.title ? truncate(data.title, 200) : "";
	const similarities = data.similarities ? truncate(data.similarities, 400) : "";
	const learnings = data.learnings ? truncate(data.learnings, 400) : "";
	return `AGENT_SIMILAR_INCIDENT id=${id} title="${title}" similarities="${similarities}" learnings="${learnings}"`;
}

export function isSuggestionEvent(event: AgentEvent) {
	return event.event_type === "MESSAGE_ADDED" && event.event_metadata?.kind === "suggestion" && !!event.event_metadata?.agentSuggestionId;
}

export function isInternalAgentEvent(event: AgentEvent) {
	return isSuggestionEvent(event) || event.event_type === "SIMILAR_INCIDENT" || event.event_type === "CONTEXT_AGENT_TRIGGERED";
}

function formatContextAgentTriggeredEvent(event: AgentEvent) {
	const data = event.event_data as {
		agent?: string;
		reason?: string;
		evidence?: string;
	};
	const agent = data.agent ?? "unknown";
	const reason = data.reason ? ` reason="${truncate(data.reason, 140)}"` : "";
	const evidence = data.evidence ? ` evidence="${truncate(data.evidence, 180)}"` : "";
	return `AGENT_CONTEXT_TRIGGER agent=${agent}${reason}${evidence}`;
}

export function formatAgentEventForPrompt(event: AgentEvent): string {
	if (event.event_type === "CONTEXT_AGENT_TRIGGERED") {
		return formatContextAgentTriggeredEvent(event);
	}
	if (event.event_type === "SIMILAR_INCIDENT") {
		return formatSimilarIncidentEvent(event);
	}
	if (isSuggestionEvent(event)) {
		const data = event.event_data as Record<string, unknown>;
		if (data.suggestion && typeof data.suggestion === "object") {
			return `AGENT_SUGGESTION: ${formatSuggestionPayload(data.suggestion as Record<string, unknown>)}`;
		}
		const message = typeof data.message === "string" ? truncate(data.message, 180) : "";
		return `AGENT_SUGGESTION: ${message}`;
	}
	return `${event.event_type}: ${JSON.stringify(event.event_data)}`;
}
