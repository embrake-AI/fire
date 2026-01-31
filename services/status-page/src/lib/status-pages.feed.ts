import type { IncidentDetailData } from "./status-pages.server";

export type FeedFormat = "rss" | "atom";

type FeedEntry = {
	id: string;
	title: string;
	summary: string;
	date: Date;
};

const STATUS_LABELS: Record<string, string> = {
	investigating: "Investigating",
	mitigating: "Mitigating",
	resolved: "Resolved",
};

function escapeXml(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function formatRfc2822(date: Date): string {
	return new Date(date).toUTCString();
}

function formatIso(date: Date): string {
	return new Date(date).toISOString();
}

function buildEntries(data: IncidentDetailData): FeedEntry[] {
	const updates = data.incident.updates;
	if (updates.length === 0) {
		return [
			{
				id: `${data.incident.id}-created`,
				title: `Incident created: ${data.incident.title}`,
				summary: "Incident created.",
				date: data.incident.createdAt,
			},
		];
	}

	return updates.map((update) => {
		const label = update.status ? (STATUS_LABELS[update.status] ?? "Update") : "Update";
		return {
			id: update.id,
			title: `${label}: ${data.incident.title}`,
			summary: update.message || `${label} posted.`,
			date: update.createdAt,
		};
	});
}

function buildRssFeed(options: { title: string; description: string; siteUrl: string; feedUrl: string; updatedAt: Date; entries: FeedEntry[] }): string {
	const items = options.entries
		.map((entry) => {
			return `
		<item>
			<title>${escapeXml(entry.title)}</title>
			<link>${escapeXml(options.siteUrl)}</link>
			<guid isPermaLink="false">${escapeXml(entry.id)}</guid>
			<pubDate>${formatRfc2822(entry.date)}</pubDate>
			<description>${escapeXml(entry.summary)}</description>
		</item>`;
		})
		.join("");

	return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
	<channel>
		<title>${escapeXml(options.title)}</title>
		<link>${escapeXml(options.siteUrl)}</link>
		<description>${escapeXml(options.description)}</description>
		<lastBuildDate>${formatRfc2822(options.updatedAt)}</lastBuildDate>
		${items}
	</channel>
</rss>`;
}

function buildAtomFeed(options: { title: string; siteUrl: string; feedUrl: string; updatedAt: Date; entries: FeedEntry[] }): string {
	const entries = options.entries
		.map((entry) => {
			return `
	<entry>
		<title>${escapeXml(entry.title)}</title>
		<link href="${escapeXml(options.siteUrl)}" />
		<id>${escapeXml(entry.id)}</id>
		<updated>${formatIso(entry.date)}</updated>
		<summary>${escapeXml(entry.summary)}</summary>
	</entry>`;
		})
		.join("");

	return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
	<title>${escapeXml(options.title)}</title>
	<link href="${escapeXml(options.siteUrl)}" rel="alternate" />
	<link href="${escapeXml(options.feedUrl)}" rel="self" />
	<id>${escapeXml(options.feedUrl)}</id>
	<updated>${formatIso(options.updatedAt)}</updated>
	${entries}
</feed>`;
}

export function normalizeFeedFormat(rawFormat: string | null): FeedFormat {
	switch (rawFormat?.toLowerCase()) {
		case "atom":
		case "atom+xml":
			return "atom";
		default:
			return "rss";
	}
}

export function buildIncidentFeedResponse(options: { data: IncidentDetailData; format: FeedFormat; feedUrl: string; siteUrl: string }): Response {
	const { data, format, feedUrl, siteUrl } = options;
	const entries = buildEntries(data);
	const updatedAt = entries[0]?.date ?? data.incident.resolvedAt ?? data.incident.createdAt ?? new Date();
	const title = `${data.incident.title} - ${data.page.name}`;

	const cacheControl = data.incident.resolvedAt ? "public, max-age=86400, stale-while-revalidate=3600" : "public, max-age=30, stale-while-revalidate=60";

	let body = "";
	let contentType = "";

	if (format === "atom") {
		body = buildAtomFeed({
			title,
			siteUrl,
			feedUrl,
			updatedAt,
			entries,
		});
		contentType = "application/atom+xml; charset=utf-8";
	} else {
		body = buildRssFeed({
			title,
			description: `Updates for "${data.incident.title}" on ${data.page.name}.`,
			siteUrl,
			feedUrl,
			updatedAt,
			entries,
		});
		contentType = "application/rss+xml; charset=utf-8";
	}

	return new Response(body, {
		status: 200,
		headers: {
			"Content-Type": contentType,
			"Cache-Control": cacheControl,
		},
	});
}
