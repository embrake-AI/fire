import { IS_SEVERITY } from "@fire/common";
import type { ActionsBlock, KnownBlock } from "@slack/types";
import type { Incident, SenderParams, StepDo } from "../../../dispatcher/workflow";
import { addIncidentIdentifiers } from "../../dashboard/sender";
import { incidentChannelIdentifier, slackThreadIdentifier } from "../shared";

type SlackApiResponse = {
	ok?: boolean;
	ts?: string;
	error?: string;
};

type SlackChannelResponse = {
	ok: boolean;
	channel?: { id: string; name: string };
	error?: string;
};

type ChannelResult = { channelId: string; channelName?: string };

const CHANNEL_NAME_MAX_LENGTH = 80;
const CHANNEL_DATE_MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function formatIncidentChannelDate(date: Date): string {
	const day = date.getUTCDate();
	const month = CHANNEL_DATE_MONTHS[date.getUTCMonth()];
	return `${day}-${month}`;
}

function formatIncidentChannelName(title: string, date = new Date()): string {
	const baseTitle = title.trim() || "incident";
	const rawSlug = baseTitle.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
	const slug = rawSlug.replace(/^[-_]+|[-_]+$/g, "") || "incident";
	const dateLabel = formatIncidentChannelDate(date);
	const prefix = "inc-";
	const suffix = `-${dateLabel}`;
	const maxSlugLength = Math.max(1, CHANNEL_NAME_MAX_LENGTH - prefix.length - suffix.length);
	const truncatedSlug = slug.slice(0, maxSlugLength).replace(/[-_]+$/g, "") || "incident";
	return `${prefix}${truncatedSlug}${suffix}`;
}

/**
 * Creates a public Slack channel for an incident.
 * Channel name format: inc-{incident-title}-{day-month}
 */
async function createIncidentChannel(stepDo: StepDo, botToken: string, title: string): Promise<ChannelResult | null> {
	const channelName = formatIncidentChannelName(title);

	return stepDo(
		"slack.conversations.create",
		{
			retries: {
				limit: 3,
				delay: "1 second",
			},
		},
		async () => {
			const response = await fetch("https://slack.com/api/conversations.create", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${botToken}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					name: channelName,
					is_private: false,
				}),
			});
			const payload = await response.json<SlackChannelResponse>();
			if (!payload.ok) {
				throw new Error(`Failed to create channel: ${payload.error}`);
			}
			return { channelId: payload.channel!.id, channelName: payload.channel!.name };
		},
	);
}

/**
 * Invites a user to a Slack channel.
 */
async function inviteToChannel(stepDo: StepDo, botToken: string, channelId: string, userId: string): Promise<void> {
	await stepDo(
		"slack.conversations.invite",
		{
			retries: {
				limit: 3,
				delay: "1 second",
			},
		},
		async () => {
			const response = await fetch("https://slack.com/api/conversations.invite", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${botToken}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					channel: channelId,
					users: userId,
				}),
			});
			const payload = await response.json<{ ok: boolean; error?: string }>();
			// Ignore already_in_channel error
			if (!payload.ok && payload.error !== "already_in_channel") {
				throw new Error(`Failed to invite user: ${payload.error}`);
			}
		},
	);
}

/**
 * Archives a Slack channel.
 */
async function archiveChannel(stepDo: StepDo, botToken: string, channelId: string): Promise<void> {
	await stepDo(
		"slack.conversations.archive",
		{
			retries: {
				limit: 3,
				delay: "1 second",
			},
		},
		async () => {
			const response = await fetch("https://slack.com/api/conversations.archive", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${botToken}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ channel: channelId }),
			});
			const payload = await response.json<{ ok: boolean; error?: string }>();
			// Ignore already_archived error
			if (!payload.ok && payload.error !== "already_archived") {
				throw new Error(`Failed to archive channel: ${payload.error}`);
			}
		},
	);
}

/**
 * Posts a message to a Slack channel.
 */
async function postToChannel(stepDo: StepDo, botToken: string, channelId: string, text: string, stepName: string): Promise<void> {
	await stepDo(
		stepName,
		{
			retries: {
				limit: 3,
				delay: "1 second",
			},
		},
		async () => {
			const response = await fetch("https://slack.com/api/chat.postMessage", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${botToken}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					channel: channelId,
					text,
				}),
			});
			const payload = await response.json<SlackApiResponse>();
			if (!response.ok || payload.ok === false) {
				throw new Error(`Slack postMessage failed: ${payload.error ?? response.status}`);
			}
		},
	);
}

async function pinMessage(stepDo: StepDo, botToken: string, channelId: string, messageTs: string): Promise<void> {
	await stepDo(
		"slack.pins.add",
		{
			retries: {
				limit: 3,
				delay: "1 second",
			},
		},
		async () => {
			const response = await fetch("https://slack.com/api/pins.add", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${botToken}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					channel: channelId,
					timestamp: messageTs,
				}),
			});
			const payload = await response.json<SlackApiResponse>();
			if (!response.ok || payload.ok === false) {
				throw new Error(`Slack pin failed: ${payload.error ?? response.status}`);
			}
		},
	);
}

/**
 * Useful guide to create Slack messages (has sub-routes for each type of message):
 *   - https://docs.slack.dev/messaging/
 */

export async function incidentStarted(params: SenderParams["incidentStarted"]) {
	const { step: stepDo, env, id, incident, metadata } = params;
	const { severity, status, assignee, title } = incident;
	const { botToken, channel, thread, incidentChannelId, incidentChannelMessageTs: existingIncidentChannelMessageTs, postedMessageTs } = metadata;
	if (!botToken || !channel) {
		// Thread is optional, if we have a channel and no thread, we'll post in the channel directly
		return;
	}

	if (postedMessageTs && incidentChannelId && existingIncidentChannelMessageTs) {
		// Already posted and channel created, so no need to send again
		return;
	}

	const channelResult = incidentChannelId
		? { channelId: incidentChannelId, channelName: metadata.incidentChannelName }
		: await createIncidentChannel(stepDo, botToken, title).catch((err) => {
				console.error("Failed to create incident channel", err);
				return null;
			});

	if (channelResult && assignee) {
		await inviteToChannel(stepDo, botToken, channelResult.channelId, assignee).catch((err) => {
			console.warn("Failed to invite assignee to channel", err);
		});
	}

	const blocks = incidentBlocks({ frontendUrl: env.FRONTEND_URL, incidentId: id, severity, status, assigneeUserId: assignee, title });
	const shouldBroadcast = severity === "high" && !!thread;

	let threadPostResult: PromiseSettledResult<{ ts: string }> | null = null;
	if (!postedMessageTs) {
		const [postResult] = await Promise.allSettled([
			stepDo(
				`slack.post-message`,
				{
					retries: {
						limit: 3,
						delay: "1 second",
					},
				},
				async () => {
					const response = await fetch(`https://slack.com/api/chat.postMessage`, {
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
					});
					const payload = await response.json<SlackApiResponse>();
					if (!response.ok || payload.ok === false || !payload.ts) {
						throw new Error(`Slack postMessage failed: ${payload.error ?? response.status}`);
					}
					return { ts: payload.ts };
				},
			),
			stepDo(
				"slack.remove-reaction",
				{
					retries: {
						limit: 3,
						delay: "1 second",
					},
				},
				async () => {
					const response = await fetch(`https://slack.com/api/reactions.remove`, {
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
					});
					const payload = await response.json<SlackApiResponse>().catch(() => ({}) as SlackApiResponse);
					if (!response.ok || payload.ok === false) {
						throw new Error(`Slack remove reaction failed: ${payload.error ?? response.status}`);
					}
				},
			),
		]);
		threadPostResult = postResult;
	}

	let incidentChannelMessageTs: string | undefined = existingIncidentChannelMessageTs;
	let postedIncidentChannelMessage = false;
	if (channelResult && !existingIncidentChannelMessageTs) {
		const channelPostResult = await stepDo(
			"slack.post-incident-channel-message",
			{
				retries: {
					limit: 3,
					delay: "1 second",
				},
			},
			async () => {
				const response = await fetch(`https://slack.com/api/chat.postMessage`, {
					method: "POST",
					headers: {
						Authorization: `Bearer ${botToken}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						text: `Incident: ${title}`,
						channel: channelResult.channelId,
						blocks,
						metadata: {
							event_type: "incident",
							event_payload: { id },
						},
					}),
				});
				const payload = await response.json<SlackApiResponse>();
				if (!response.ok || payload.ok === false || !payload.ts) {
					throw new Error(`Slack postMessage to incident channel failed: ${payload.error ?? response.status}`);
				}
				return { ts: payload.ts };
			},
		).catch((err) => {
			console.error("Failed to post to incident channel", err);
			return null;
		});
		incidentChannelMessageTs = channelPostResult?.ts;
		postedIncidentChannelMessage = !!incidentChannelMessageTs;
	}
	if (channelResult && postedIncidentChannelMessage && incidentChannelMessageTs) {
		await pinMessage(stepDo, botToken, channelResult.channelId, incidentChannelMessageTs).catch((err) => {
			console.warn("Failed to pin incident message", err);
		});
	}

	const metadataUpdates: Record<string, string> = {};
	if (channelResult) {
		if (channelResult.channelId !== incidentChannelId) {
			metadataUpdates.incidentChannelId = channelResult.channelId;
		}
		if (channelResult.channelName && channelResult.channelName !== metadata.incidentChannelName) {
			metadataUpdates.incidentChannelName = channelResult.channelName;
		}
	}
	if (incidentChannelMessageTs && incidentChannelMessageTs !== existingIncidentChannelMessageTs) {
		metadataUpdates.incidentChannelMessageTs = incidentChannelMessageTs;
	}
	if (threadPostResult?.status === "fulfilled") {
		const { ts } = threadPostResult.value;
		metadataUpdates.postedMessageTs = ts;
		metadataUpdates.channel = channel;
		metadataUpdates.thread = thread ?? ts;
	} else if (threadPostResult) {
		console.error("Failed to create incident", threadPostResult.reason);
	}

	const identifiersToAdd: string[] = [];
	if (channelResult?.channelId) {
		identifiersToAdd.push(incidentChannelIdentifier(channelResult.channelId));
	}
	const threadIdentifier = thread ?? (threadPostResult?.status === "fulfilled" ? threadPostResult.value.ts : undefined);
	if (threadIdentifier) {
		identifiersToAdd.push(slackThreadIdentifier(channel, threadIdentifier));
	}
	if (identifiersToAdd.length) {
		await addIncidentIdentifiers({ step: stepDo, env, id, identifiers: identifiersToAdd });
	}

	if (Object.keys(metadataUpdates).length) {
		await stepDo(
			"incident.addMetadata",
			{
				retries: {
					limit: 3,
					delay: "1 second",
				},
			},
			async () => {
				const incident = env.INCIDENT.get(env.INCIDENT.idFromString(id));
				await incident.addMetadata(metadataUpdates);
			},
		);
	}
}

export async function incidentSeverityUpdated(params: SenderParams["incidentSeverityUpdated"]) {
	const { step: stepDo, env, id, incident, metadata } = params;
	const { severity, status, assignee, title } = incident;
	const { botToken, channel, thread, postedMessageTs, incidentChannelId, incidentChannelMessageTs } = metadata;
	if (!botToken) {
		return;
	}
	const shouldBroadcast = severity === "high" && !!thread;

	if (channel && postedMessageTs) {
		await updateIncidentMessage({
			stepDo,
			stepName: "slack.update-message.thread",
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

	if (incidentChannelId) {
		if (incidentChannelMessageTs) {
			await updateIncidentMessage({
				stepDo,
				stepName: "slack.update-message.incident-channel",
				frontendUrl: env.FRONTEND_URL,
				botToken,
				channel: incidentChannelId,
				postedMessageTs: incidentChannelMessageTs,
				id,
				severity,
				status,
				assignee,
				incidentName: title,
			});
		}
		await postToChannel(stepDo, botToken, incidentChannelId, `Severity changed to *${severity}*`, "slack.post-severity-update");
	}
}

export async function incidentAssigneeUpdated(params: SenderParams["incidentAssigneeUpdated"]) {
	const { step: stepDo, env, id, incident, metadata } = params;
	const { severity, status, assignee, title } = incident;
	const { botToken, channel, postedMessageTs, incidentChannelId, incidentChannelMessageTs } = metadata;
	if (!botToken) {
		return;
	}

	if (channel && postedMessageTs) {
		await updateIncidentMessage({
			stepDo,
			stepName: "slack.update-message.thread",
			frontendUrl: env.FRONTEND_URL,
			botToken,
			channel,
			postedMessageTs,
			id,
			severity,
			status,
			assignee,
			incidentName: title,
		});
	}

	if (incidentChannelId) {
		if (assignee) {
			await inviteToChannel(stepDo, botToken, incidentChannelId, assignee).catch((err) => {
				console.warn("Failed to invite new assignee to channel", err);
			});
		}
		if (incidentChannelMessageTs) {
			await updateIncidentMessage({
				stepDo,
				stepName: "slack.update-message.incident-channel",
				frontendUrl: env.FRONTEND_URL,
				botToken,
				channel: incidentChannelId,
				postedMessageTs: incidentChannelMessageTs,
				id,
				severity,
				status,
				assignee,
				incidentName: title,
			});
		}
		const assigneeText = assignee ? `Assignee changed to <@${assignee}>` : "Assignee cleared";
		await postToChannel(stepDo, botToken, incidentChannelId, assigneeText, "slack.post-assignee-update");
	}
}

export async function incidentStatusUpdated(params: SenderParams["incidentStatusUpdated"]) {
	const { step: stepDo, env, id, incident, message, metadata } = params;
	const { severity, status, assignee, title } = incident;
	const { botToken, channel, postedMessageTs, incidentChannelId, incidentChannelMessageTs } = metadata;
	if (!botToken) {
		return;
	}

	if (channel && postedMessageTs) {
		await updateIncidentMessage({
			stepDo,
			stepName: "slack.update-message.thread",
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

	if (incidentChannelId) {
		if (incidentChannelMessageTs) {
			await updateIncidentMessage({
				stepDo,
				stepName: "slack.update-message.incident-channel",
				frontendUrl: env.FRONTEND_URL,
				botToken,
				channel: incidentChannelId,
				postedMessageTs: incidentChannelMessageTs,
				id,
				severity,
				status,
				assignee,
				statusMessage: message,
				incidentName: title,
			});
		}

		const statusEmoji = status === "resolved" ? "✅" : status === "mitigating" ? "🟡" : "🔴";
		const statusText = message ? `Status: ${statusEmoji} *${status}*\n${message}` : `Status: ${statusEmoji} *${status}*`;
		await postToChannel(stepDo, botToken, incidentChannelId, statusText, "slack.post-status-update");

		if (status === "resolved") {
			await postToChannel(stepDo, botToken, incidentChannelId, "This channel will now be archived.", "slack.post-archive-notice");
			await archiveChannel(stepDo, botToken, incidentChannelId).catch((err) => {
				console.warn("Failed to archive incident channel", err);
			});
		}
	}
}

async function updateIncidentMessage({
	stepDo,
	stepName,
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
	stepDo: StepDo;
	stepName: string;
	frontendUrl: string;
	botToken: string;
	channel: string;
	postedMessageTs: string;
	id: string;
	severity: Incident["severity"];
	status: Incident["status"];
	assignee?: string;
	statusMessage?: string;
	broadcast?: boolean;
	incidentName: string;
}) {
	const blocks = incidentBlocks({ frontendUrl, incidentId: id, severity, status, assigneeUserId: assignee, statusMessage, title: incidentName });
	const textFallback = `${incidentName} - ${status === "resolved" ? "resolved ✅" : status === "mitigating" ? "mitigating 🟡" : "open 🔴"}`;
	await stepDo(
		stepName,
		{
			retries: {
				limit: 3,
				delay: "1 second",
			},
		},
		async () => {
			const response = await fetch(`https://slack.com/api/chat.update`, {
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
			const payload = await response.json<SlackApiResponse>().catch(() => ({}) as SlackApiResponse);
			if (!response.ok || payload.ok === false) {
				throw new Error(`Slack update message failed: ${payload.error ?? response.status}`);
			}
		},
	);
	// broadcast if needed (can't update content and broadcast in the same request)
	if (broadcast) {
		await stepDo(
			`slack.broadcast`,
			{
				retries: {
					limit: 3,
					delay: "1 second",
				},
			},
			async () => {
				const response = await fetch(`https://slack.com/api/chat.update`, {
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
				});
				const payload = await response.json<SlackApiResponse>().catch(() => ({}) as SlackApiResponse);
				if (!response.ok || payload.ok === false) {
					throw new Error(`Slack broadcast failed: ${payload.error ?? response.status}`);
				}
			},
		).catch((error) => {
			console.warn("Slack broadcast failed", error);
		});
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
		? `<${frontendUrl}/metrics/${incidentId}|${title}> - ✅ resolved`
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

export async function messageAdded(params: SenderParams["messageAdded"]) {
	const { step: stepDo, message, metadata, sourceAdapter, slackUserToken } = params;

	if (sourceAdapter === "slack") {
		return;
	}

	const { botToken, channel, postedMessageTs, incidentChannelId, incidentChannelMessageTs } = metadata;

	// Determine target: prefer inc-xxx channel, fallback to original thread
	const targetChannel = incidentChannelId ?? channel;
	const targetThreadTs = incidentChannelId ? incidentChannelMessageTs : postedMessageTs;

	if (!targetChannel || !targetThreadTs) {
		return;
	}

	const token = slackUserToken ?? botToken;
	if (!token) {
		return;
	}

	await stepDo(
		"slack.post-message",
		{
			retries: {
				limit: 3,
				delay: "1 second",
			},
		},
		async () => {
			const response = await fetch("https://slack.com/api/chat.postMessage", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					channel: targetChannel,
					thread_ts: targetThreadTs,
					text: message,
				}),
			});
			const payload = await response.json<SlackApiResponse>();
			if (!response.ok || payload.ok === false) {
				throw new Error(`Slack postMessage failed: ${payload.error ?? response.status}`);
			}
		},
	);
}

export async function summaryResponse(params: SenderParams["summaryResponse"]) {
	const { step: stepDo, description, channel, threadTs, ts, metadata, sourceAdapter } = params;

	if (sourceAdapter !== "slack") {
		return;
	}

	const { botToken } = metadata;
	if (!botToken) {
		return;
	}

	const replyThreadTs = threadTs ?? ts;

	await stepDo(
		"slack.post-summary-response",
		{
			retries: {
				limit: 3,
				delay: "1 second",
			},
		},
		async () => {
			const response = await fetch("https://slack.com/api/chat.postMessage", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${botToken}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					channel,
					text: `*Summary*\n${description}`,
					...(replyThreadTs ? { thread_ts: replyThreadTs } : {}),
				}),
			});
			const payload = await response.json<SlackApiResponse>().catch(() => ({}) as SlackApiResponse);
			if (!response.ok || payload.ok === false) {
				throw new Error(`Slack postMessage failed: ${payload.error ?? response.status}`);
			}
		},
	);
}
