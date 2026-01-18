export function slackThreadIdentifier(channel: string, threadTs: string): string {
	return `slack-thread:${channel}-${threadTs}`;
}

export function incidentChannelIdentifier(channelId: string): string {
	return `slack-channel:${channelId}`;
}
