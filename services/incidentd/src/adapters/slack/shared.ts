export function normalizeIncidentIdentifier(identifier: string): string {
	return identifier.replace(/[.\s]/g, "-");
}

export function incidentChannelNameFromIdentifier(identifier: string): string {
	return `inc-${identifier}`;
}

export function extractIdentifierFromChannelName(channelName: string): string | null {
	const match = channelName.match(/^inc-(.+)$/);
	return match ? match[1] : null;
}
