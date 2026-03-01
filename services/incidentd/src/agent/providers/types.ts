import type { AgentEvent } from "../types";

export type ProviderContextTrigger = "agent-turn" | "prompt";

export type AddContextInput = {
	toEventId: number;
	events: AgentEvent[];
	trigger: ProviderContextTrigger;
	requestedAt: string;
};

export type AddContextResult = {
	deduped: boolean;
	enqueuedToEventId: number;
};

export type PromptInput = {
	question: string;
	requestedAt: string;
	maxStalenessMs?: number;
};

export type PromptResult = {
	answer: string;
	freshness: "fresh" | "in_progress" | "empty";
	asOfEventId: number;
};

export type ExportedAgentStep = {
	id: number;
	role: string;
	content: string;
	name: string | null;
	tool_call_id: string | null;
	source: string;
	context_to_event_id: number | null;
	run_id: string | null;
	created_at: string;
};

export type ExportedAgentContext = {
	id: number;
	to_event_id: number;
	trigger: string;
	requested_at: string;
	appended_step_start_id: number | null;
	appended_step_end_id: number | null;
	created_at: string;
};

export type AgentExport = {
	provider: { name: string; description: string };
	incidentId: string;
	steps: ExportedAgentStep[];
	contexts: ExportedAgentContext[];
};
