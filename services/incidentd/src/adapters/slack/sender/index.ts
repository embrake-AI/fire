import { type IS, IS_SEVERITY } from "@fire/common";
import type { ActionsBlock, KnownBlock } from "@slack/types";
import type { Context } from "hono";
import type { DOState } from "../../../core/incident";
import type { BasicContext } from "../../../handler";

/**
 * Useful guide to create Slack messages (has sub-routes for each type of message):
 *   - https://docs.slack.dev/messaging/
 */

export async function incidentStarted<E extends BasicContext>(c: Context<E>, { id, severity, status, assignee, metadata }: DOState) {
	const { botToken, channel, thread } = metadata;
	if (!botToken || !channel || !thread) {
		// Not created through Slack, so no message to send
		return;
	}
	const blocks = incidentBlocks(c.env.FRONTEND_URL, id, severity, status, assignee);
	const [response] = await Promise.allSettled([
		fetch(`https://slack.com/api/chat.postMessage`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${botToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				text: "Incident created 🔴",
				channel,
				thread_ts: thread,
				reply_broadcast: true, // Show in both thread AND main channel
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

export async function incidentSeverityUpdated<E extends BasicContext>(c: Context<E>, newSeverity: IS["severity"], { id, status, assignee, metadata }: DOState) {
	const { botToken, channel, thread, postedMessageTs } = metadata;
	if (!botToken || !channel || !thread || !postedMessageTs) {
		// Not created through Slack, so no message to send
		return;
	}
	await updateIncidentMessage({ frontendUrl: c.env.FRONTEND_URL, botToken, channel, postedMessageTs, id, severity: newSeverity, status, assignee });
}

export async function incidentAssigneeUpdated<E extends BasicContext>(c: Context<E>, newAssignee: string, { id, severity, status, metadata }: DOState) {
	const { botToken, channel, thread, postedMessageTs } = metadata;
	if (!botToken || !channel || !thread || !postedMessageTs) {
		// Not created through Slack, so no message to send
		return;
	}
	await updateIncidentMessage({ frontendUrl: c.env.FRONTEND_URL, botToken, channel, postedMessageTs, id, severity, status, assignee: newAssignee });
}

export async function incidentStatusUpdated<E extends BasicContext>(
	c: Context<E>,
	newStatus: Exclude<IS["status"], "open">,
	message: string,
	{ id, severity, assignee, metadata }: DOState,
) {
	const { botToken, channel, thread, postedMessageTs } = metadata;
	if (!botToken || !channel || !thread || !postedMessageTs) {
		// Not created through Slack, so no message to send
		return;
	}
	await updateIncidentMessage({
		frontendUrl: c.env.FRONTEND_URL,
		botToken,
		channel,
		postedMessageTs,
		id,
		severity,
		status: newStatus,
		assignee,
		statusMessage: message,
	});
}

async function updateIncidentMessage({
	frontendUrl,
	botToken,
	channel,
	postedMessageTs,
	id,
	severity,
	status,
	assignee,
	statusMessage,
}: {
	frontendUrl: string;
	botToken: string;
	channel: string;
	postedMessageTs: string;
	id: string;
	severity: IS["severity"];
	status: IS["status"];
	assignee: string;
	statusMessage?: string;
}) {
	const blocks = incidentBlocks(frontendUrl, id, severity, status, assignee, statusMessage);
	const textFallback = status === "resolved" ? "Incident resolved ✅" : status === "mitigating" ? "Incident mitigating 🟡" : "Incident updated 🔴";
	await fetch(`https://slack.com/api/chat.update`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${botToken}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			channel,
			ts: postedMessageTs,
			text: textFallback,
			blocks,
		}),
	});
}

/**
 * Returns the valid status transitions for a given status.
 * open -> mitigating, resolved
 * mitigating -> resolved
 * resolved -> (none, terminal state)
 */
function getValidStatusTransitions(currentStatus: IS["status"]): IS["status"][] {
	switch (currentStatus) {
		case "open":
			return ["mitigating", "resolved"];
		case "mitigating":
			return ["resolved"];
		case "resolved":
			return [];
	}
}

/**
 * Format status for display with emoji indicator
 */
function formatStatus(status: IS["status"]): string {
	switch (status) {
		case "open":
			return "🔴 Open";
		case "mitigating":
			return "🟡 Mitigating";
		case "resolved":
			return "🟢 Resolved";
	}
}

function incidentBlocks(frontendUrl: string, incidentId: string, severity: IS["severity"], status: IS["status"], assigneeUserId?: string, statusMessage?: string): KnownBlock[] {
	const isResolved = status === "resolved";
	const isMitigating = status === "mitigating";
	const validTransitions = getValidStatusTransitions(status);

	const headerText = isResolved
		? `✅ <${frontendUrl}/analysis/${incidentId}|Incident resolved>`
		: isMitigating
			? `🟡 <${frontendUrl}/incidents/${incidentId}|Incident mitigating>`
			: `🚨 <${frontendUrl}/incidents/${incidentId}|Incident created>`;

	const blocks: KnownBlock[] = [
		{
			type: "section",
			text: {
				type: "mrkdwn",
				text: headerText,
			},
		},
		{
			type: "section",
			fields: [
				{ type: "mrkdwn", text: `*Severity:*\n${severity}` },
				{ type: "mrkdwn", text: `*Assignee:*\n${assigneeUserId ? `<@${assigneeUserId}>` : "_Unassigned_"}` },
			],
		},
	];

	if (statusMessage && (isMitigating || isResolved)) {
		const messageLabel = isResolved ? "Resolution" : "Mitigation";
		blocks.push({
			type: "section",
			text: {
				type: "mrkdwn",
				text: `*${messageLabel}:*\n${statusMessage}`,
			},
		});
	}

	blocks.push({ type: "divider" });

	if (!isResolved) {
		const actionElements: ActionsBlock["elements"] = [
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
		];

		if (validTransitions.length > 0) {
			actionElements.push({
				type: "static_select",
				action_id: "set_status",
				placeholder: { type: "plain_text", text: "Update status" },
				options: validTransitions.map((s) => ({
					text: { type: "plain_text", text: formatStatus(s) },
					value: s,
				})),
			});
		}

		blocks.push({
			type: "actions",
			block_id: `incident:${incidentId}`,
			elements: actionElements,
		});
	}

	return blocks;
}
