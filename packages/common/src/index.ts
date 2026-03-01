export const IS_STATUS = ["open", "mitigating", "resolved", "declined"] as const;
type IS_STATUS = (typeof IS_STATUS)[number];

export const IS_SEVERITY = ["low", "medium", "high"] as const;
type IS_SEVERITY = (typeof IS_SEVERITY)[number];

export const IS_SOURCE = ["slack", "dashboard"] as const;
type IS_SOURCE = (typeof IS_SOURCE)[number];

export type IS = {
	id: string;
	createdAt: Date;
	status: IS_STATUS;
	prompt: string;
	severity: IS_SEVERITY;
	createdBy: string;
	assignee: { slackId: string }; // TODO: When/if we support more platforms for incident, think about this
	source: IS_SOURCE;
	title: string;
	description: string;
	entryPointId: string;
	rotationId: string | undefined;
	teamId: string | undefined;
};

export type ListIncidentsElement = Pick<IS, "id" | "status" | "severity" | "createdAt" | "title" | "description" | "assignee">;

export type IS_Event =
	| {
			event_type: "INCIDENT_CREATED";
			event_data: Pick<IS, "status" | "severity" | "createdBy" | "title" | "description" | "prompt" | "source" | "entryPointId" | "rotationId"> & { assignee: string };
	  }
	| {
			event_type: "STATUS_UPDATE";
			event_data: {
				status: IS["status"];
				message: string;
			};
	  }
	| {
			event_type: "ASSIGNEE_UPDATE";
			event_data: {
				assignee: IS["assignee"];
			};
	  }
	| {
			event_type: "SEVERITY_UPDATE";
			event_data: {
				severity: IS["severity"];
			};
	  }
	| {
			event_type: "AFFECTION_UPDATE";
			event_data: {
				message: string;
				status?: "investigating" | "mitigating" | "resolved";
				title?: string;
				services?: { id: string; impact: "partial" | "major" }[];
				createdBy: string;
			};
	  }
	| {
			event_type: "MESSAGE_ADDED";
			event_data: {
				message: string;
				userId: string;
				messageId: string;
			};
	  }
	| {
			event_type: "SIMILAR_INCIDENT";
			event_data: {
				originRunId: string;
				similarIncidentId: string;
				sourceIncidentIds: string[];
				title: string;
				incidentStatus: string;
				summary: string;
				similarities: string;
				learnings: string;
			};
	  }
	| {
			event_type: "CONTEXT_AGENT_TRIGGERED";
			event_data: {
				agent: string;
				turnId: string;
				evidence: string;
				reason: string;
				triggeredAt: string;
			};
	  };

export type EventLog = {
	id: number;
	created_at: string;
	event_type: IS_Event["event_type"];
	event_data: string;
	event_metadata: string | null;
	published_at: string | null;
	attempts: number;
	adapter: "slack" | "dashboard" | "fire";
};

export type EntryPoint = {
	id: string;
	prompt: string;
	assignee: {
		id: string;
		slackId: string;
	};
	isFallback: boolean;
	rotationId: string | undefined;
	teamId: string | undefined;
};

export type ShiftLength = (typeof SHIFT_LENGTH_OPTIONS)[number]["value"];
export const SHIFT_LENGTH_OPTIONS = [
	{ value: "1 day", label: "1 day" },
	{ value: "1 week", label: "1 week" },
	{ value: "2 weeks", label: "2 weeks" },
] as const;

export function truncate(value: string, max: number): string {
	const trimmed = value.trim();
	if (trimmed.length <= max) {
		return trimmed;
	}
	return `${trimmed.slice(0, max - 1)}...`;
}

export function emailInDomains(email: string, domains: string[]) {
	const emailDomain = email.split("@")[1]?.toLowerCase();
	return !!emailDomain && domains.some((domain) => domain.toLowerCase() === emailDomain);
}
