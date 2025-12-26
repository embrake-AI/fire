import type { EntryPoint, IS } from "@fire/common";
import { ASSERT } from "../lib/utils";

type IncidentInfo = {
	assignee: string;
	severity: IS["severity"];
	title: string;
	description: string;
};

// We could allow users to tune the system prompt (when high, medium, low)
const SYSTEM_PROMPT = `You are an incident triage assistant. Given an incident report and a list of entry points (each with a prompt describing when to be chosen and an assignee), you must:

1. Select the most appropriate assignee based on which entry point best matches the incident. If no entry point is a clear match, you MUST select the one marked as "FALLBACK".
2. Determine the severity (low, medium, or high) based on the impact and urgency
3. Generate a concise title (max 60 chars) that captures the essence of the incident
4. Write a brief description explaining the incident and why you chose that entry point

Guidelines for severity:
- high: System down, data loss, security breach, or major customer impact
- medium: Degraded performance, partial outage, or significant functionality issues
- low: Minor issues, questions/missunderstandings, cosmetic problems, or low-impact bugs`;

const RESPONSE_SCHEMA = (assignees: string[]) =>
	({
		type: "object",
		properties: {
			assignee: {
				type: "string",
				enum: assignees,
				description: "The assignee from the matching entry point",
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
		required: ["assignee", "severity", "title", "description"],
		additionalProperties: false,
	}) as const;

export async function calculateIncidentInfo(prompt: string, entryPoints: EntryPoint[], openaiApiKey: string): Promise<IncidentInfo> {
	ASSERT(entryPoints.length > 0, "At least one entry point is required");

	const entryPointsDescription = entryPoints
		.map((ep, i) => `${i + 1}. Assignee: ${ep.assignee}\n   Choose when: ${ep.prompt}${ep.isFallback ? " (FALLBACK - Choose if no others match)" : ""}`)
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
					schema: RESPONSE_SCHEMA(entryPoints.map((ep) => ep.assignee)),
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

	return JSON.parse(content) as IncidentInfo;
}
