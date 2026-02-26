import type { EntryPoint, IS, IS_Event } from "@fire/common";
import { ASSERT } from "../lib/utils";

type IncidentInfo = {
	selectedEntryPoint: EntryPoint;
	severity: IS["severity"];
	title: string;
	description: string;
};

type IncidentPostmortemTimelineItem = {
	created_at: string;
	text: string;
};

export type IncidentPostmortem = {
	timeline: IncidentPostmortemTimelineItem[];
	rootCause: string;
	impact: string;
	actions: string[];
};

// We could allow users to tune the system prompt (when high, medium, low)
const SYSTEM_PROMPT = `You are an incident triage assistant. Given an incident report and a list of entry points (each with a prompt describing when to be chosen and an assignee), you must:

1. Select the most appropriate entry point index based on which entry point best matches the incident. If no entry point is a clear match, you MUST select the index of the one marked as "FALLBACK".
2. Determine the severity (low, medium, or high) based on the impact and urgency
3. Generate a concise title (max 60 chars) that captures the essence of the incident
4. Write a brief description explaining the incident and why you chose that entry point

Guidelines for severity:
- high: System down, data loss, security breach, or major customer impact. Affects multiple clients
- medium: Degraded performance, partial outage, or significant functionality issues. Affects one or more clients
- low: Minor issues, questions/missunderstandings, cosmetic problems, or low-impact bugs`;

const RESPONSE_SCHEMA = (indices: number[]) =>
	({
		type: "object",
		properties: {
			entryPointIndex: {
				type: "integer",
				enum: indices,
				description: "The index of the matching entry point (0-indexed)",
			},
			severity: {
				type: "string",
				enum: ["low", "medium", "high"],
				description: "The incident severity level",
			},
			title: {
				type: "string",
				description: "A concise title for the incident (max 60 characters)",
			},
			description: {
				type: "string",
				description: "A brief description explaining the incident and why that entry point was chosen",
			},
		},
		required: ["entryPointIndex", "severity", "title", "description"],
		additionalProperties: false,
	}) as const;

export async function calculateIncidentInfo(prompt: string, entryPoints: EntryPoint[], openaiApiKey: string): Promise<IncidentInfo> {
	ASSERT(entryPoints.length > 0, "At least one entry point is required");

	const entryPointsDescription = entryPoints
		.map((ep, i) => `Index ${i}: Assignee: ${ep.assignee.id}\n   Choose when: ${ep.prompt}${ep.isFallback ? " (FALLBACK - Choose if no others match)" : ""}`)
		.join("\n");

	const userMessage = `Entry Points:
${entryPointsDescription}

Incident Report:
${prompt}

Select the most appropriate entry point and provide the incident details.`;

	const response = await fetch("https://api.openai.com/v1/chat/completions", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${openaiApiKey}`,
		},
		body: JSON.stringify({
			model: "gpt-5.2",
			messages: [
				{ role: "system", content: SYSTEM_PROMPT },
				{ role: "user", content: userMessage },
			],
			response_format: {
				type: "json_schema",
				json_schema: {
					name: "incident_info",
					strict: true,
					schema: RESPONSE_SCHEMA(entryPoints.map((_, i) => i)),
				},
			},
		}),
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`OpenAI API error: ${response.status} - ${error}`);
	}

	const data = (await response.json()) as {
		id?: string;
		model?: string;
		usage?: {
			prompt_tokens?: number;
			completion_tokens?: number;
			total_tokens?: number;
			prompt_tokens_details?: { cached_tokens?: number };
		};
		choices: Array<{ message: { content: string } }>;
	};
	const content = data.choices[0]?.message?.content;
	ASSERT(content, "No response content from OpenAI");

	const { entryPointIndex, severity, title, description } = JSON.parse(content);
	const selectedEntryPoint = entryPoints[entryPointIndex];
	return { selectedEntryPoint, severity, title, description };
}

const POSTMORTEM_SYSTEM_PROMPT = `You are an incident post-mortem analyst. Given incident details and a timeline of events, produce a structured post-mortem.

Requirements:
- timeline: pick only the MOST IMPORTANT events (chronological). Each item needs "created_at" (ISO 8601) and "text" (short sentence). Keep this short and strictly include at most one event per event type (e.g. only one severity update, only one assignee change, only one status transition).
- rootCause: concise paragraph. If unclear, say "Root cause not determined from available data."
- impact: concise paragraph describing what was impacted and severity.
- actions: 0-6 concrete follow-ups written as short imperative sentences. Only include actions that are clearly relevant to the incident, and prefer fewer actions over more.

Do not include markdown. Only use the information provided.`;

const POSTMORTEM_RESPONSE_SCHEMA = {
	type: "object",
	properties: {
		timeline: {
			type: "array",
			items: {
				type: "object",
				properties: {
					created_at: { type: "string", description: "ISO 8601 timestamp" },
					text: { type: "string" },
				},
				required: ["created_at", "text"],
				additionalProperties: false,
			},
			minItems: 1,
			maxItems: 6,
		},
		rootCause: { type: "string" },
		impact: { type: "string" },
		actions: {
			type: "array",
			items: { type: "string" },
			minItems: 0,
			maxItems: 6,
		},
	},
	required: ["timeline", "rootCause", "impact", "actions"],
	additionalProperties: false,
} as const;

function extractStatus(event: { event_type: string; event_data: unknown }) {
	if (event.event_type !== "STATUS_UPDATE") return null;
	const data = event.event_data as { status?: string };
	return typeof data?.status === "string" ? data.status : null;
}

function isHumanMessageEvent(event: { event_type: string; event_data: unknown }) {
	if (event.event_type !== "MESSAGE_ADDED") {
		return false;
	}
	const data = event.event_data as { userId?: string };
	return !!data?.userId && data.userId !== "fire";
}

export async function generateIncidentPostmortem(
	incident: { title: string; description: string; severity: IS["severity"]; prompt: string; createdAt: Date },
	events: Array<{ event_type: IS_Event["event_type"]; event_data: IS_Event["event_data"]; created_at: string }>,
	openaiApiKey: string,
): Promise<IncidentPostmortem> {
	const startedAt = events.find((event) => event.event_type === "INCIDENT_CREATED")?.created_at ?? events[0]?.created_at ?? null;
	const startedAtMs = startedAt ? new Date(startedAt).getTime() : NaN;
	const isOnOrAfterStart = (createdAt: string) => {
		if (Number.isNaN(startedAtMs)) {
			return true;
		}
		const eventMs = new Date(createdAt).getTime();
		return !Number.isNaN(eventMs) && eventMs >= startedAtMs;
	};

	const firstResponseAt = events.find((event) => isHumanMessageEvent(event) && isOnOrAfterStart(event.created_at))?.created_at ?? null;
	const mitigatedAt = events.find((event) => extractStatus(event) === "mitigating" && isOnOrAfterStart(event.created_at))?.created_at ?? null;
	const resolvedAt = [...events].reverse().find((event) => extractStatus(event) === "resolved" && isOnOrAfterStart(event.created_at))?.created_at ?? null;

	const eventDescriptions = events.map((e) => `[${e.created_at}] ${e.event_type}: ${JSON.stringify(e.event_data)}`).join("\n");

	const userMessage = `Incident: ${incident.title}
Description: ${incident.description}
Severity: ${incident.severity}
Original Report: ${incident.prompt}
Created At: ${incident.createdAt.toISOString()}

Timing:
- startedAt: ${startedAt ?? "unknown"}
- firstResponseAt: ${firstResponseAt ?? "unknown"}
- mitigatedAt: ${mitigatedAt ?? "unknown"}
- resolvedAt: ${resolvedAt ?? "unknown"}

Timeline Events:
${eventDescriptions}

Generate the post-mortem.`;

	const response = await fetch("https://api.openai.com/v1/chat/completions", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${openaiApiKey}`,
		},
		body: JSON.stringify({
			model: "gpt-5.2",
			messages: [
				{ role: "system", content: POSTMORTEM_SYSTEM_PROMPT },
				{ role: "user", content: userMessage },
			],
			response_format: {
				type: "json_schema",
				json_schema: {
					name: "incident_postmortem",
					strict: true,
					schema: POSTMORTEM_RESPONSE_SCHEMA,
				},
			},
		}),
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`OpenAI API error: ${response.status} - ${error}`);
	}

	const data = (await response.json()) as {
		id?: string;
		model?: string;
		usage?: {
			prompt_tokens?: number;
			completion_tokens?: number;
			total_tokens?: number;
			prompt_tokens_details?: { cached_tokens?: number };
		};
		choices: Array<{ message: { content: string } }>;
	};
	const content = data.choices[0]?.message?.content;
	ASSERT(content, "No response content from OpenAI");

	const parsed = JSON.parse(content) as IncidentPostmortem;
	return parsed;
}
