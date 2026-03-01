import type { IS, IS_Event } from "@fire/common";
import type { Metadata } from "../handler";

export type AgentIncidentSnapshot = {
	id: string;
	status: IS["status"];
	severity: IS["severity"];
	title: string;
	description: string;
	prompt: string;
	assignee: string;
	source: IS["source"];
	createdAt: string;
};

export type AgentEvent = {
	id: number;
	event_type: IS_Event["event_type"];
	event_data: IS_Event["event_data"];
	created_at: string;
	adapter: "slack" | "dashboard" | "fire";
	event_metadata?: Record<string, string> | null;
};

export type AgentService = {
	id: string;
	name: string;
	prompt: string | null;
};

export type AgentAffectionStatus = "investigating" | "mitigating" | "resolved";

export type AgentAffectionInfo = {
	hasAffection: boolean;
	lastStatus?: AgentAffectionStatus;
	lastUpdateAt?: string;
};

export type AgentTurnPayload = {
	incidentId: string;
	turnId: string;
	fromEventId: number;
	toEventId: number;
	incident: AgentIncidentSnapshot;
	metadata: Metadata;
	services: AgentService[];
	affection: AgentAffectionInfo;
	events: AgentEvent[];
};

export type AgentPromptPayload = {
	incidentId: string;
	prompt: string;
	userId: string;
	ts: string;
	channel: string;
	threadTs?: string;
	adapter: "slack" | "dashboard" | "fire";
};

export type AgentSuggestion =
	| {
			action: "update_status";
			status: Exclude<IS["status"], "open">;
			message: string;
	  }
	| {
			action: "update_severity";
			severity: IS["severity"];
	  }
	| {
			action: "add_status_page_update";
			message: string;
			affectionStatus?: AgentAffectionStatus;
			title?: string;
			services?: { id: string; impact: "partial" | "major" }[];
	  };

export type AgentSuggestionContext = {
	incident: AgentIncidentSnapshot;
	services: AgentService[];
	affection: AgentAffectionInfo;
	events: AgentEvent[];
	processedThroughId?: number;
	validStatusTransitions: Array<Exclude<IS["status"], "open">>;
	prompt?: {
		text: string;
		userId: string;
		ts: string;
		channel: string;
		threadTs?: string;
	};
};

export type AgentContextResponse =
	| {
			incident: AgentIncidentSnapshot;
			metadata: Metadata;
			services: AgentService[];
			affection: AgentAffectionInfo;
			events: AgentEvent[];
	  }
	| {
			error: string;
	  };
