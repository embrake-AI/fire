export function slackThreadIdentifier(channel: string, threadTs: string): string {
	return `slack-thread:${channel}-${threadTs}`;
}

export function incidentChannelIdentifier(channelId: string): string {
	return `slack-channel:${channelId}`;
}

export async function addReaction(botToken: string, channel: string, timestamp: string, name: string): Promise<void> {
	await fetch("https://slack.com/api/reactions.add", {
		method: "POST",
		headers: { Authorization: `Bearer ${botToken}`, "Content-Type": "application/json" },
		body: JSON.stringify({ name, channel, timestamp }),
	}).catch(() => {});
}
