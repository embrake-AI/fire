import type { IncidentAnalysis, IncidentTimelineItem } from "../incidents/incidents";

const NOTION_API_VERSION = "2022-06-28";

type NotionRichText = {
	type: "text";
	text: { content: string; link?: { url: string } | null };
	annotations?: {
		bold?: boolean;
		italic?: boolean;
		strikethrough?: boolean;
		underline?: boolean;
		code?: boolean;
		color?: string;
	};
};

type NotionBlock = {
	object: "block";
	type: string;
	[key: string]: unknown;
};

function text(content: string, annotations?: NotionRichText["annotations"]): NotionRichText {
	return {
		type: "text",
		text: { content },
		annotations,
	};
}

function heading2(content: string): NotionBlock {
	return {
		object: "block",
		type: "heading_2",
		heading_2: { rich_text: [text(content)] },
	};
}

function paragraph(content: string): NotionBlock {
	return {
		object: "block",
		type: "paragraph",
		paragraph: { rich_text: [text(content)] },
	};
}

function bulletedListItem(content: string): NotionBlock {
	return {
		object: "block",
		type: "bulleted_list_item",
		bulleted_list_item: { rich_text: [text(content)] },
	};
}

function divider(): NotionBlock {
	return {
		object: "block",
		type: "divider",
		divider: {},
	};
}

function callout(content: string, emoji: string, color: string = "gray_background"): NotionBlock {
	return {
		object: "block",
		type: "callout",
		callout: {
			rich_text: [text(content)],
			icon: { emoji },
			color,
		},
	};
}

function todoItem(content: string): NotionBlock {
	return {
		object: "block",
		type: "to_do",
		to_do: {
			rich_text: [text(content)],
			checked: false,
		},
	};
}

function formatDuration(start: Date | string, end: Date | string): string {
	const startDate = new Date(start);
	const endDate = new Date(end);
	const durationMs = endDate.getTime() - startDate.getTime();
	const minutes = Math.floor(durationMs / 60000);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	if (days > 0) return `${days}d ${hours % 24}h`;
	if (hours > 0) return `${hours}h ${minutes % 60}m`;
	return `${minutes}m`;
}

export function postMortemToNotionBlocks(analysis: IncidentAnalysis): NotionBlock[] {
	const blocks: NotionBlock[] = [];

	const severityEmoji = analysis.severity === "high" ? "\u{1F534}" : analysis.severity === "medium" ? "\u{1F7E1}" : "\u{1F7E2}";
	const severityColor = analysis.severity === "high" ? "red_background" : analysis.severity === "medium" ? "yellow_background" : "green_background";

	blocks.push(callout(`Severity: ${analysis.severity.toUpperCase()} | Duration: ${formatDuration(analysis.createdAt, analysis.resolvedAt)}`, severityEmoji, severityColor));

	if (analysis.description) {
		blocks.push(heading2("Summary"));
		blocks.push(paragraph(analysis.description));
	}

	blocks.push(divider());

	blocks.push(heading2("Timeline"));
	const timeline = (analysis.timeline ?? []) as IncidentTimelineItem[];
	if (timeline.length > 0) {
		for (const item of timeline) {
			const timestamp = new Date(item.created_at).toLocaleString();
			blocks.push(bulletedListItem(`${timestamp}: ${item.text}`));
		}
	} else {
		blocks.push(paragraph("No timeline entries recorded."));
	}

	blocks.push(divider());

	blocks.push(heading2("Impact"));
	blocks.push(paragraph(analysis.impact || "No impact assessment recorded."));

	blocks.push(divider());

	blocks.push(heading2("Root Cause"));
	blocks.push(paragraph(analysis.rootCause || "No root cause analysis recorded."));

	blocks.push(divider());

	blocks.push(heading2("Action Items"));
	if (analysis.actions && analysis.actions.length > 0) {
		for (const action of analysis.actions) {
			blocks.push(todoItem(action.description));
		}
	} else {
		blocks.push(paragraph("No action items recorded."));
	}

	blocks.push(divider());
	blocks.push(callout(`Created: ${new Date(analysis.createdAt).toLocaleString()} | Resolved: ${new Date(analysis.resolvedAt).toLocaleString()}`, "\u{1F4C5}", "gray_background"));

	return blocks;
}

export async function createNotionPage(accessToken: string, parentPageId: string, title: string, blocks: NotionBlock[]): Promise<{ id: string; url: string }> {
	const response = await fetch("https://api.notion.com/v1/pages", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": "application/json",
			"Notion-Version": NOTION_API_VERSION,
		},
		body: JSON.stringify({
			parent: { page_id: parentPageId },
			properties: {
				title: {
					title: [{ type: "text", text: { content: title } }],
				},
			},
			children: blocks.slice(0, 100), // Notion API limits to 100 blocks per request
		}),
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Failed to create Notion page: ${error}`);
	}

	const page = (await response.json()) as { id: string; url: string };
	return { id: page.id, url: page.url };
}

type NotionSearchResult = {
	object: string;
	id: string;
	properties?: {
		title?: {
			title?: Array<{ plain_text?: string }>;
		};
	};
	icon?: { emoji?: string } | null;
};

export async function searchNotionPages(accessToken: string, query?: string): Promise<Array<{ id: string; title: string; icon: string | null }>> {
	const response = await fetch("https://api.notion.com/v1/search", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": "application/json",
			"Notion-Version": NOTION_API_VERSION,
		},
		body: JSON.stringify({
			query: query || "",
			filter: { property: "object", value: "page" },
			page_size: 20,
		}),
	});

	if (!response.ok) {
		throw new Error("Failed to search Notion pages");
	}

	const data = (await response.json()) as { results: NotionSearchResult[] };
	return data.results.map((page) => ({
		id: page.id,
		title: page.properties?.title?.title?.[0]?.plain_text || "Untitled",
		icon: page.icon?.emoji || null,
	}));
}
