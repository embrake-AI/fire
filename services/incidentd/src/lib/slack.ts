export type SlackPostMessageResponse = { ok?: boolean; ts?: string; error?: string };

export function slackThreadIdentifier(channel: string, threadTs: string): string {
	return `slack-thread:${channel}-${threadTs}`;
}

export function incidentChannelIdentifier(channelId: string): string {
	return `slack-channel:${channelId}`;
}

export async function addReaction(botToken: string, channel: string, timestamp: string, name: string): Promise<void> {
	try {
		const response = await fetch("https://slack.com/api/reactions.add", {
			method: "POST",
			headers: { Authorization: `Bearer ${botToken}`, "Content-Type": "application/json" },
			body: JSON.stringify({ name, channel, timestamp }),
		});
		if (!response.ok) {
			const body = await response.text().catch(() => "");
			console.error("Slack add reaction failed", { status: response.status, body });
		}
	} catch (error) {
		console.error("Slack add reaction error", error);
	}
}

export async function removeReaction(botToken: string, channel: string, timestamp: string, name: string): Promise<void> {
	try {
		const response = await fetch("https://slack.com/api/reactions.remove", {
			method: "POST",
			headers: { Authorization: `Bearer ${botToken}`, "Content-Type": "application/json" },
			body: JSON.stringify({ name, channel, timestamp }),
		});
		if (!response.ok) {
			const body = await response.text().catch(() => "");
			console.error("Slack remove reaction failed", { status: response.status, body });
		}
	} catch (error) {
		console.error("Slack remove reaction error", error);
	}
}

export async function postSlackMessage({
	botToken,
	channel,
	text,
	threadTs,
	blocks,
	metadata,
	replyBroadcast,
}: {
	botToken: string;
	channel: string;
	text: string;
	threadTs?: string;
	blocks?: unknown;
	metadata?: { event_type: string; event_payload: Record<string, unknown> };
	replyBroadcast?: boolean;
}): Promise<SlackPostMessageResponse> {
	const response = await fetch("https://slack.com/api/chat.postMessage", {
		method: "POST",
		headers: { Authorization: `Bearer ${botToken}`, "Content-Type": "application/json" },
		body: JSON.stringify({
			channel,
			text,
			...(threadTs ? { thread_ts: threadTs } : {}),
			...(blocks ? { blocks } : {}),
			...(metadata ? { metadata } : {}),
			...(replyBroadcast ? { reply_broadcast: true } : {}),
		}),
	});
	const payload = await response.json<SlackPostMessageResponse>().catch(() => ({ ok: false, error: "invalid_response" }));
	if (!response.ok || payload.ok === false) {
		throw new Error(`Slack postMessage failed: ${payload.error ?? response.status}`);
	}
	return payload;
}
