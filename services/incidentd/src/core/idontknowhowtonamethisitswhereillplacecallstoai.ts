import type { EntryPoint, EventLog, IS } from "@fire/common";
import { ASSERT } from "../lib/utils";

type IncidentInfo = {
	selectedEntryPoint: EntryPoint;
	severity: IS["severity"];
	title: string;
	description: string;
};

export type PromptDecision = {
	action: "update_status" | "update_severity" | "summarize" | "noop";
	status?: Exclude<IS["status"], "open">;
	severity?: IS["severity"];
	message?: string;
};

// We could allow users to tune the system prompt (when high, medium, low)
const SYSTEM_PROMPT = `You are an incident triage assistant. Given an incident report and a list of entry points (each with a prompt describing when to be chosen and an assignee), you must:

1. Select the most appropriate entry point index based on which entry point best matches the incident. If no entry point is a clear match, you MUST select the index of the one marked as "FALLBACK".
2. Determine the severity (low, medium, or high) based on the impact and urgency
3. Generate a concise title (max 60 chars) that captures the essence of the incident
4. Write a brief description explaining the incident and why you chose that entry point

Guidelines for severity:
- high: System down, data loss, security breach, or major customer impact
- medium: Degraded performance, partial outage, or significant functionality issues
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
		choices: Array<{ message: { content: string } }>;
	};

	const content = data.choices[0]?.message?.content;
	ASSERT(content, "No response content from OpenAI");

	const { entryPointIndex, severity, title, description } = JSON.parse(content);
	const selectedEntryPoint = entryPoints[entryPointIndex];
	return { selectedEntryPoint, severity, title, description };
}

const SUMMARY_SYSTEM_PROMPT = `You are an incident post-mortem analyst. Given an incident's details and its timeline of events, generate a concise summary of what happened, how it was handled, and the resolution.

Your summary should:
1. Briefly describe what the incident was about
2. Highlight key actions taken (assignee changes, severity updates, status transitions)
3. Mention how long it took for the incident to be acknowledged, and how long it lasted
4. Note any important messages or decisions made during the incident

Keep the summary to 2-5 sentences, focusing on the most important aspects.`;

const PROMPT_DECISION_SYSTEM_PROMPT = `You are an incident operations assistant. Given a user's @fire prompt and the current incident status/severity, decide the single best action:

- update_status: only if the user explicitly asks to mark the incident as mitigating or resolved.
- update_severity: only if the user explicitly asks to change severity to low/medium/high.
- summarize: only if the user explicitly asks for a summary or recap.
- noop: if the intent is unclear or doesn't match the options.

Return only the action and any required fields. Do not guess missing values.`;

const PROMPT_DECISION_SCHEMA = {
	type: "object",
	properties: {
		action: {
			type: "string",
			enum: ["update_status", "update_severity", "summarize", "noop"],
		},
		status: {
			type: "string",
			enum: ["mitigating", "resolved"],
		},
		severity: {
			type: "string",
			enum: ["low", "medium", "high"],
		},
		message: {
			type: "string",
		},
	},
	required: ["action"],
	additionalProperties: false,
} as const;

export async function generateIncidentSummary(
	incident: { title: string; description: string; severity: IS["severity"]; prompt: string },
	events: Pick<EventLog, "event_type" | "event_data" | "created_at">[],
	openaiApiKey: string,
): Promise<string> {
	const eventDescriptions = events.map((e) => `[${e.created_at}] ${e.event_type}: ${e.event_data}`).join("\n");

	const userMessage = `Incident: ${incident.title}
Description: ${incident.description}
Severity: ${incident.severity}
Original Report: ${incident.prompt}

Timeline:
${eventDescriptions}

Generate a summary of this incident.`;

	const response = await fetch("https://api.openai.com/v1/chat/completions", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${openaiApiKey}`,
		},
		body: JSON.stringify({
			model: "gpt-4o-mini",
			messages: [
				{ role: "system", content: SUMMARY_SYSTEM_PROMPT },
				{ role: "user", content: userMessage },
			],
		}),
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`OpenAI API error: ${response.status} - ${error}`);
	}

	const data = (await response.json()) as {
		choices: Array<{ message: { content: string } }>;
	};

	const content = data.choices[0]?.message?.content;
	ASSERT(content, "No response content from OpenAI");

	return content;
}

export async function decidePromptAction(
	{
		prompt,
		incident,
		validStatusTransitions,
	}: {
		prompt: string;
		incident: Pick<IS, "status" | "severity" | "title">;
		validStatusTransitions: Array<Exclude<IS["status"], "open">>;
	},
	openaiApiKey: string,
): Promise<PromptDecision> {
	const userMessage = `Incident:
Title: ${incident.title}
Status: ${incident.status}
Severity: ${incident.severity}
Valid status transitions: ${validStatusTransitions.length ? validStatusTransitions.join(", ") : "none"}

User prompt:
${prompt}

Decide the best single action.`;

	const response = await fetch("https://api.openai.com/v1/chat/completions", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${openaiApiKey}`,
		},
		body: JSON.stringify({
			model: "gpt-4o-mini",
			messages: [
				{ role: "system", content: PROMPT_DECISION_SYSTEM_PROMPT },
				{ role: "user", content: userMessage },
			],
			response_format: {
				type: "json_schema",
				json_schema: {
					name: "prompt_decision",
					strict: true,
					schema: PROMPT_DECISION_SCHEMA,
				},
			},
		}),
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`OpenAI API error: ${response.status} - ${error}`);
	}

	const data = (await response.json()) as {
		choices: Array<{ message: { content: string } }>;
	};

	const content = data.choices[0]?.message?.content;
	ASSERT(content, "No response content from OpenAI");

	return JSON.parse(content) as PromptDecision;
}
