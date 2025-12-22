import { type IS, IS_SEVERITY } from "@fire/common";
import type { KnownBlock } from "@slack/types";
import type { Context } from "hono";
import type { DOState } from "../../../core/incident";
import type { BasicContext } from "../../../handler";

/**
 * Useful guide to create Slack messages (has sub-routes for each type of message):
 *   - https://docs.slack.dev/messaging/
 */

export async function incidentStarted<E extends BasicContext>(c: Context<E>, { id, severity, assignee, metadata }: DOState) {
	const { botToken, channel, thread } = metadata;
	if (!botToken || !channel || !thread) {
		console.error("Missing metadata", metadata);
		return;
	}
	const blocks = incidentBlocks(c.env.FRONTEND_URL, id, severity, assignee);
	const [response] = await Promise.allSettled([
		fetch(`https://slack.com/api/chat.postMessage`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${botToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				text: "Incident created :fire:",
				channel,
				thread_ts: thread,
				blocks,
			}),
		}),
		fetch(`https://slack.com/api/reactions.remove`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${botToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				name: "fire",
				channel,
				timestamp: thread,
			}),
		}),
	]);
	if (response.status === "fulfilled") {
		const { ts } = await response.value.json<{ ts: string }>();
		if (!ts) {
			console.error("Failed to create incident", response);
			return;
		}
		const incident = c.env.INCIDENT.get(c.env.INCIDENT.idFromString(id));
		await incident.addMetadata({ postedMessageTs: ts });
	}
}

const isValidSeverity = (severity: string): severity is IS["severity"] => IS_SEVERITY.some((s) => s === severity);
export async function incidentSeverityUpdated<E extends BasicContext>(c: Context<E>, newSeverity: string, { id, assignee, metadata }: DOState) {
	const { botToken, channel, thread, postedMessageTs } = metadata;
	if (!botToken || !channel || !thread || !postedMessageTs) {
		console.error("Missing metadata", metadata);
		return;
	}
	if (!isValidSeverity(newSeverity)) {
		console.error("Invalid severity", newSeverity);
		return;
	}
	await updateIncidentMessage({ frontendUrl: c.env.FRONTEND_URL, botToken, channel, postedMessageTs, id, severity: newSeverity, assignee });
}

export async function incidentAssigneeUpdated<E extends BasicContext>(c: Context<E>, newAssignee: string, { id, severity, metadata }: DOState) {
	const { botToken, channel, thread, postedMessageTs } = metadata;
	if (!botToken || !channel || !thread || !postedMessageTs) {
		console.error("Missing metadata", metadata);
		return;
	}
	await updateIncidentMessage({ frontendUrl: c.env.FRONTEND_URL, botToken, channel, postedMessageTs, id, severity, assignee: newAssignee });
}

async function updateIncidentMessage({
	frontendUrl,
	botToken,
	channel,
	postedMessageTs,
	id,
	severity,
	assignee,
}: {
	frontendUrl: string;
	botToken: string;
	channel: string;
	postedMessageTs: string;
	id: string;
	severity: IS["severity"];
	assignee: string;
}) {
	const blocks = incidentBlocks(frontendUrl, id, severity, assignee);
	await fetch(`https://slack.com/api/chat.update`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${botToken}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			channel,
			ts: postedMessageTs,
			text: "Incident updated :fire:",
			blocks,
		}),
	});
}

function incidentBlocks(frontendUrl: string, incidentId: string, severity: IS["severity"], assigneeUserId?: string): KnownBlock[] {
	return [
		{
			type: "section",
			text: {
				type: "mrkdwn",
				text: `🚨 <${frontendUrl}/incidents/${incidentId}|Incident created>`,
			},
		},
		{
			type: "section",
			fields: [
				{ type: "mrkdwn", text: `*Severity:*\n${severity}` },
				{
					type: "mrkdwn",
					text: `*Assignee:*\n${assigneeUserId ? `<@${assigneeUserId}>` : "_Unassigned_"}`,
				},
			],
		},
		{ type: "divider" },
		{
			type: "actions",
			block_id: `incident:${incidentId}`, // <— key: embeds incidentId
			elements: [
				{
					type: "static_select",
					action_id: "set_severity",
					placeholder: { type: "plain_text", text: "Change severity" },
					initial_option: {
						text: { type: "plain_text", text: severity },
						value: severity,
					},
					options: IS_SEVERITY.map((p) => ({
						text: { type: "plain_text", text: p },
						value: p,
					})),
				},
				{
					type: "users_select",
					action_id: "set_assignee",
					placeholder: { type: "plain_text", text: "Assign to…" },
					...(assigneeUserId ? { initial_user: assigneeUserId } : {}),
				},
			],
		},
	] as const;
}
