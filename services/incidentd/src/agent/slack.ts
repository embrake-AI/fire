import type { ActionsBlock, KnownBlock } from "@slack/types";
import type { AgentSuggestion } from "./types";

export type AgentSuggestionPayload = AgentSuggestion & {
	incidentId: string;
	suggestionId: string;
	turnId?: string;
};

const SLACK_BUTTON_VALUE_MAX = 2000;

function formatSuggestionText(suggestion: AgentSuggestion, serviceMap: Record<string, string>): string {
	switch (suggestion.action) {
		case "update_status":
			return `Update status to *${suggestion.status}* with message: ${suggestion.message}`;
		case "update_severity":
			return `Update severity to *${suggestion.severity}*.`;
		case "add_status_page_update": {
			const statusText = suggestion.affectionStatus ? ` (status: *${suggestion.affectionStatus}*)` : "";
			const servicesText = suggestion.services?.length
				? ` Services: ${suggestion.services
						.map((service) => {
							const name = serviceMap[service.id] ?? service.id;
							return `${name} (${service.impact})`;
						})
						.join(", ")}.`
				: "";
			return `Post status page update${statusText}: ${suggestion.message}.${servicesText}`;
		}
	}
}

function trimText(value: string, max: number) {
	const trimmed = value.trim();
	if (trimmed.length <= max) return trimmed;
	return `${trimmed.slice(0, max - 1)}…`;
}

function normalizePayloadForSlack(payload: AgentSuggestionPayload): AgentSuggestionPayload {
	if (payload.action === "update_status") {
		return {
			...payload,
			message: trimText(payload.message, 200),
		};
	}
	if (payload.action === "add_status_page_update") {
		return {
			...payload,
			message: trimText(payload.message, 200),
			...(payload.title ? { title: trimText(payload.title, 120) } : {}),
			...(payload.services?.length ? { services: payload.services.slice(0, 10) } : {}),
		};
	}
	return payload;
}

function encodePayload(payload: AgentSuggestionPayload): string | null {
	let normalized = normalizePayloadForSlack(payload);
	let encoded = JSON.stringify(normalized);
	if (encoded.length <= SLACK_BUTTON_VALUE_MAX) {
		return encoded;
	}

	if ("message" in normalized) {
		const message = trimText(normalized.message, 120);
		normalized = { ...normalized, message };
		encoded = JSON.stringify(normalized);
		if (encoded.length <= SLACK_BUTTON_VALUE_MAX) {
			return encoded;
		}
	}

	return null;
}

// TODO: @Miquel => check if this generic suggestions are good enough or we should make it custom per action type
export function buildAgentSuggestionBlocks({
	suggestions,
	incidentId,
	turnId,
	serviceMap,
}: {
	suggestions: AgentSuggestion[];
	incidentId: string;
	turnId?: string;
	serviceMap?: Record<string, string>;
}): {
	blocks: KnownBlock[];
	text: string;
} {
	const header = "*:fire: suggestions*";
	const map = serviceMap ?? {};
	const blocks: KnownBlock[] = [
		{
			type: "section",
			text: { type: "mrkdwn", text: header },
		},
		{ type: "divider" },
	];

	const textFallback = suggestions.map((suggestion) => formatSuggestionText(suggestion, map)).join("\n");

	suggestions.forEach((suggestion, index) => {
		const suggestionId = `${incidentId}:${turnId ?? "prompt"}:${index + 1}`;
		const payload: AgentSuggestionPayload = { ...suggestion, incidentId, suggestionId, ...(turnId ? { turnId } : {}) };
		const encodedPayload = encodePayload(payload);
		blocks.push({
			type: "section",
			text: {
				type: "mrkdwn",
				text: formatSuggestionText(suggestion, map),
			},
		});

		if (encodedPayload) {
			const actions: ActionsBlock = {
				type: "actions",
				elements: [
					{
						type: "button",
						action_id: "agent_apply",
						text: { type: "plain_text", text: "Apply" },
						value: encodedPayload,
						style: "primary",
					},
				],
			};

			if ("message" in suggestion) {
				actions.elements.push({
					type: "button",
					action_id: "agent_edit",
					text: { type: "plain_text", text: "Edit" },
					value: encodedPayload,
				});
			}

			blocks.push(actions);
		}
		if (index < suggestions.length - 1) {
			blocks.push({ type: "divider" });
		}
	});

	return { blocks, text: textFallback || "Agent suggestions" };
}

export async function postAgentSuggestions({ botToken, channel, blocks, text }: { botToken: string; channel: string; blocks: KnownBlock[]; text: string }): Promise<void> {
	const response = await fetch("https://slack.com/api/chat.postMessage", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${botToken}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			channel,
			text,
			blocks,
		}),
	});

	const payload = await response.json<{ ok?: boolean; error?: string }>().catch(() => ({ ok: false, error: "invalid_response" }));
	if (!response.ok || payload.ok === false) {
		throw new Error(`Slack postMessage failed: ${payload.error ?? response.status}`);
	}
}
