import { IS_SEVERITY } from "@fire/common";
import type { ActionsBlock, KnownBlock } from "@slack/types";
import type { Incident } from "../../../dispatcher";
import type { Metadata } from "../../../handler";

/**
 * Useful guide to create Slack messages (has sub-routes for each type of message):
 *   - https://docs.slack.dev/messaging/
 */

export async function incidentStarted(env: Env, id: string, { severity, status, assignee, title }: Incident, metadata: Metadata) {
	const { botToken, channel, thread } = metadata;
	if (!botToken || !channel) {
		// Thread is optional, if we have a channel and no thread, we'll post in the channel directly
		return;
	}
	if (metadata.postedMessageTs) {
		// Already posted, so no need to send again
		return;
	}
	const blocks = incidentBlocks({ frontendUrl: env.FRONTEND_URL, incidentId: id, severity, status, assigneeUserId: assignee, title });
	const shouldBroadcast = severity === "high" && !!thread;
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
				...(shouldBroadcast && { reply_broadcast: true }),
				blocks,
				metadata: {
					event_type: "incident",
					event_payload: { id },
				},
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
		const incident = env.INCIDENT.get(env.INCIDENT.idFromString(id));
		await incident.addMetadata({ postedMessageTs: ts, channel, thread: thread ?? ts });
	}
}

export async function incidentSeverityUpdated(env: Env, id: string, incident: Incident, metadata: Metadata) {
	const { severity, status, assignee, title } = incident;
	const { botToken, channel, thread, postedMessageTs } = metadata;
	if (!botToken || !channel || !postedMessageTs) {
		// Not created through Slack, so no message to send
		return;
	}
	const shouldBroadcast = severity === "high" && !!thread;
	await updateIncidentMessage({
		frontendUrl: env.FRONTEND_URL,
		botToken,
		channel,
		postedMessageTs,
		id,
		severity,
		status,
		assignee,
		broadcast: shouldBroadcast,
		incidentName: title,
	});
}

export async function incidentAssigneeUpdated(env: Env, id: string, incident: Incident, metadata: Metadata) {
	const { severity, status, assignee, title } = incident;
	const { botToken, channel, postedMessageTs } = metadata;
	if (!botToken || !channel || !postedMessageTs) {
		// Not created through Slack, so no message to send
		return;
	}
	await updateIncidentMessage({ frontendUrl: env.FRONTEND_URL, botToken, channel, postedMessageTs, id, severity, status, assignee, incidentName: title });
}

export async function incidentStatusUpdated(env: Env, id: string, incident: Incident, message: string, metadata: Metadata) {
	const { severity, status, assignee, title } = incident;
	const { botToken, channel, postedMessageTs } = metadata;
	if (!botToken || !channel || !postedMessageTs) {
		// Not created through Slack, so no message to send
		return;
	}
	await updateIncidentMessage({
		frontendUrl: env.FRONTEND_URL,
		botToken,
		channel,
		postedMessageTs,
		id,
		severity,
		status,
		assignee,
		statusMessage: message,
		incidentName: title,
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
	broadcast,
	incidentName,
}: {
	frontendUrl: string;
	botToken: string;
	channel: string;
	postedMessageTs: string;
	id: string;
	severity: Incident["severity"];
	status: Incident["status"];
	assignee: string;
	statusMessage?: string;
	broadcast?: boolean;
	incidentName: string;
}) {
	const blocks = incidentBlocks({ frontendUrl, incidentId: id, severity, status, assigneeUserId: assignee, statusMessage, title: incidentName });
	const textFallback = `${incidentName} - ${status === "resolved" ? "resolved ✅" : status === "mitigating" ? "mitigating 🟡" : "open 🔴"}`;
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
	// broadcast if needed (can't update content and broadcast in the same request)
	if (broadcast) {
		await fetch(`https://slack.com/api/chat.update`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${botToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				channel,
				ts: postedMessageTs,
				reply_broadcast: true,
			}),
		}).catch(() => {});
	}
}

/**
 * Returns the valid status transitions for a given status.
 * open -> mitigating, resolved
 * mitigating -> resolved
 * resolved -> (none, terminal state)
 */
function getValidStatusTransitions(currentStatus: Incident["status"]): Incident["status"][] {
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
function formatStatus(status: Incident["status"]): string {
	switch (status) {
		case "open":
			return "🔴 Open";
		case "mitigating":
			return "🟡 Mitigating";
		case "resolved":
			return "🟢 Resolved";
	}
}

function incidentBlocks({
	frontendUrl,
	incidentId,
	severity,
	status,
	assigneeUserId,
	statusMessage,
	title,
}: {
	frontendUrl: string;
	incidentId: string;
	severity: Incident["severity"];
	status: Incident["status"];
	assigneeUserId?: string;
	statusMessage?: string;
	title: string;
}): KnownBlock[] {
	const isResolved = status === "resolved";
	const isMitigating = status === "mitigating";
	const validTransitions = getValidStatusTransitions(status);

	const headerText = isResolved
		? `<${frontendUrl}/analysis/${incidentId}|${title}> - ✅ resolved`
		: isMitigating
			? `<${frontendUrl}/incidents/${incidentId}|${title}> - 🟡 mitigating`
			: `<${frontendUrl}/incidents/${incidentId}|${title}> - 🚨`;

	const blocks: KnownBlock[] = [
		{
			type: "section",
			text: {
				type: "mrkdwn",
				text: headerText,
			},
		},
	];

	if (!isResolved) {
		blocks.push({
			type: "section",
			fields: [
				{ type: "mrkdwn", text: `*Severity:* ${severity}` },
				{ type: "mrkdwn", text: `*Assignee:* ${assigneeUserId ? `<@${assigneeUserId}>` : "_Unassigned_"}` },
			],
		});
	}

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

// TODO: We could post dashboard messages to slack. Not needed for now.
export const messageAdded = undefined;
