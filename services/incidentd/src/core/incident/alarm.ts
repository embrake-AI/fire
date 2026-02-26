import type { IS } from "@fire/common";

export const AGENT_INITIAL_DEBOUNCE_MS = 60_000;
export const AGENT_DEBOUNCE_MS = 13_000;

export type AgentState = {
	lastProcessedEventId: number;
	toEventId: number | null;
	nextAt?: number;
};

export function computeAgentNextAt(agentState: AgentState, now: number) {
	return agentState.lastProcessedEventId === 0 ? now + AGENT_INITIAL_DEBOUNCE_MS : now + AGENT_DEBOUNCE_MS;
}

export function shouldStartAgentTurn(agentState: AgentState, now: number) {
	const toEventId = agentState.toEventId;
	if (!agentState.nextAt || !toEventId || now < agentState.nextAt) {
		return false;
	}
	return toEventId > agentState.lastProcessedEventId;
}

export type AlarmAction = { type: "retry-events"; at: number } | { type: "run-agent"; at: number } | { type: "cleanup" } | { type: "none" };

export function decideAlarmAction({
	now,
	hasForwardableUnpublishedEvents,
	agentState,
	status,
}: {
	now: number;
	hasForwardableUnpublishedEvents: boolean;
	agentState: AgentState;
	status: IS["status"];
}): AlarmAction {
	if (hasForwardableUnpublishedEvents) {
		return { type: "retry-events", at: now };
	}

	const hasPendingAgentWork = !!agentState.nextAt && !!agentState.toEventId && agentState.toEventId > agentState.lastProcessedEventId;
	if (hasPendingAgentWork && agentState.nextAt) {
		return { type: "run-agent", at: agentState.nextAt };
	}

	if ((status === "resolved" || status === "declined") && !agentState.nextAt) {
		return { type: "cleanup" };
	}

	return { type: "none" };
}
