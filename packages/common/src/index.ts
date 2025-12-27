export const IS_STATUS = ["open", "mitigating", "resolved"] as const;
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
	assignee: string;
	source: IS_SOURCE;
	title: string;
	description: string;
};

export type ListIncidentsElement = Pick<IS, "id" | "status" | "assignee" | "severity" | "createdAt" | "title" | "description">;

export type IS_Event =
	| {
			event_type: "INCIDENT_CREATED";
			event_data: Pick<IS, "status" | "severity" | "createdBy" | "assignee" | "title" | "description" | "prompt" | "source">;
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
			event_type: "MESSAGE_ADDED";
			event_data: {
				message: string;
				userId: string;
				messageId: string;
			};
	  };

export type EventLog = {
	id: number;
	created_at: string;
	event_type: IS_Event["event_type"];
	event_data: string;
	published_at: string | null;
	attempts: number;
	adapter: "slack" | "dashboard";
};

export type EntryPoint = {
	prompt: string;
	assignee: string;
	isFallback: boolean;
};

export type ShiftLength = (typeof SHIFT_LENGTH_OPTIONS)[number]["value"];
export const SHIFT_LENGTH_OPTIONS = [
	{ value: "1 day", label: "1 day" },
	{ value: "1 week", label: "1 week" },
	{ value: "2 weeks", label: "2 weeks" },
] as const;
