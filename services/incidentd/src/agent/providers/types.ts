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
