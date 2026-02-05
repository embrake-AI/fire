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
