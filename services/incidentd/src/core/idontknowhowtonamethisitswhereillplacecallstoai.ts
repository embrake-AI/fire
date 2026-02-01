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

export type PromptDecision = {
	action: "update_status" | "update_severity" | "add_status_page_update" | "summarize" | "noop";
	status?: Exclude<IS["status"], "open">;
	severity?: IS["severity"];
	message?: string;
	affectionStatus?: "investigating" | "mitigating" | "resolved";
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

const PROMPT_DECISION_SYSTEM_PROMPT = `You are an incident operations assistant. Given a user's @fire prompt and the current incident status/severity, decide the single best action:

- update_status: only if the user explicitly asks to mark the incident as mitigating or resolved.
- update_severity: only if the user explicitly asks to change severity to low/medium/high.
 - add_status_page_update: only if the user explicitly asks to post an update to the status page. Only include status if the user explicitly requests a status change (investigating to create; resolved to close).
 - summarize: if the user asks for a summary or recap either directly, or indirectly by asking for context or wondering what's going on.
 - noop: if the intent is unclear or doesn't match the options.

Use exactly one tool to respond. Do not guess missing values. If required details are missing, use noop.`;

const PROMPT_DECISION_TOOLS = [
	{
		type: "function",
		function: {
			name: "update_status",
			description: "Update the incident status when explicitly requested. Setting status: 'resolved' completes the incident.",
			parameters: {
				type: "object",
				properties: {
					status: { type: "string", enum: ["mitigating", "resolved"] },
					message: { type: "string" },
				},
				required: ["status"],
				additionalProperties: false,
			},
		},
	},
	{
		type: "function",
		function: {
			name: "update_severity",
			description: "Update the incident severity when explicitly requested.",
			parameters: {
				type: "object",
				properties: {
					severity: { type: "string", enum: ["low", "medium", "high"] },
				},
				required: ["severity"],
				additionalProperties: false,
			},
		},
	},
	{
		type: "function",
		function: {
			name: "add_status_page_update",
			description: "Post an update to the public status page when explicitly requested.",
			parameters: {
				type: "object",
				properties: {
					message: { type: "string" },
					status: {
						type: "string",
						enum: ["investigating", "mitigating", "resolved"],
						description: "Only include when explicitly requested. 'investigating' creates the status page impact, 'resolved' closes it.",
					},
				},
				required: ["message"],
				additionalProperties: false,
			},
		},
	},
	{
		type: "function",
		function: {
			name: "summarize",
			description: "Provide a summary or recap when the user asks for context.",
			parameters: {
				type: "object",
				properties: {},
				required: [],
				additionalProperties: false,
			},
		},
	},
	{
		type: "function",
		function: {
			name: "noop",
			description: "Use when intent is unclear or does not match supported actions.",
			parameters: {
				type: "object",
				properties: {},
				required: [],
				additionalProperties: false,
			},
		},
	},
] as const;

export async function generateIncidentSummary(
	incident: { title: string; description: string; severity: IS["severity"]; prompt: string },
	events: Array<{ event_type: IS_Event["event_type"]; event_data: IS_Event["event_data"] | string; created_at: string }>,
	openaiApiKey: string,
): Promise<string> {
	const eventDescriptions = events
		.map((e) => {
			const data = typeof e.event_data === "string" ? e.event_data : JSON.stringify(e.event_data);
			return `[${e.created_at}] ${e.event_type}: ${data}`;
		})
		.join("\n");

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

function extractStatus(event: { event_type: string; event_data: unknown }) {
	if (event.event_type !== "STATUS_UPDATE") return null;
	const data = event.event_data as { status?: string };
	return typeof data?.status === "string" ? data.status : null;
}

export async function generateIncidentPostmortem(
	incident: { title: string; description: string; severity: IS["severity"]; prompt: string; createdAt: Date },
	events: Array<{ event_type: IS_Event["event_type"]; event_data: IS_Event["event_data"]; created_at: string }>,
	openaiApiKey: string,
): Promise<IncidentPostmortem> {
	const startedAt = events[0]?.created_at ?? null;
	const firstResponseAt = events.find((event) => event.event_type === "MESSAGE_ADDED")?.created_at ?? null;
	const mitigatedAt = events.find((event) => extractStatus(event) === "mitigating")?.created_at ?? null;
	const resolvedAt = [...events].reverse().find((event) => extractStatus(event) === "resolved")?.created_at ?? null;

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
		choices: Array<{ message: { content: string } }>;
	};

	const content = data.choices[0]?.message?.content;
	ASSERT(content, "No response content from OpenAI");

	const parsed = JSON.parse(content) as IncidentPostmortem;
	return parsed;
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
			tools: PROMPT_DECISION_TOOLS,
			tool_choice: "required",
		}),
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`OpenAI API error: ${response.status} - ${error}`);
	}

	const data = (await response.json()) as {
		choices: Array<{
			message: {
				content: string | null;
				tool_calls?: Array<{ function: { name: string; arguments: string } }>;
			};
		}>;
	};

	const toolCall = data.choices[0]?.message?.tool_calls?.[0];
	if (!toolCall) {
		return { action: "noop" };
	}

	const args = toolCall.function.arguments ? (JSON.parse(toolCall.function.arguments) as Record<string, unknown>) : {};
	switch (toolCall.function.name) {
		case "update_status":
			return {
				action: "update_status",
				status: args.status as PromptDecision["status"],
				message: typeof args.message === "string" ? args.message : undefined,
			};
		case "update_severity":
			return {
				action: "update_severity",
				severity: args.severity as PromptDecision["severity"],
			};
		case "add_status_page_update": {
			if (typeof args.message !== "string") {
				return { action: "noop" };
			}
			if (args.status && !["investigating", "mitigating", "resolved"].includes(String(args.status))) {
				return { action: "noop" };
			}
			return {
				action: "add_status_page_update",
				message: args.message,
				affectionStatus: args.status as PromptDecision["affectionStatus"],
			};
		}
		case "summarize":
			return { action: "summarize" };
		default:
			return { action: "noop" };
	}
}
