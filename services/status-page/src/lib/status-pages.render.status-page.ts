import { escapeHtml, POWERED_BY_URL, renderLocaleDateScript, renderLocalizedRelativeTime, renderLocalizedTime, renderSubscribePopover } from "./status-pages.render.shared";
import { computeLiveStatusInfo, type StatusPageAffectionUpdate, type StatusPagePublicData } from "./status-pages.server";

const STATUS_COLORS: Record<string, { bg: string; text: string; dot: string; bar: string }> = {
	operational: { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500", bar: "bg-emerald-500" },
	degraded: { bg: "bg-yellow-50", text: "text-yellow-700", dot: "bg-yellow-500", bar: "bg-yellow-500" },
	partial_outage: { bg: "bg-orange-50", text: "text-orange-700", dot: "bg-orange-500", bar: "bg-orange-500" },
	major_outage: { bg: "bg-red-50", text: "text-red-700", dot: "bg-red-500", bar: "bg-red-500" },
};

const STATUS_LABELS: Record<string, string> = {
	operational: "Operational",
	degraded: "Degraded Performance",
	partial_outage: "Partial Outage",
	major_outage: "Major Outage",
};

const SEVERITY_COLORS = {
	partial: { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200", dot: "bg-orange-500" },
	major: { bg: "bg-red-50", text: "text-red-700", border: "border-red-200", dot: "bg-red-500" },
};

const SEVERITY_LABELS = {
	partial: "Partial Outage",
	major: "Major Outage",
};

const UPDATE_STATUS_LABELS: Record<string, string> = {
	investigating: "Investigating",
	mitigating: "Mitigating",
	resolved: "Resolved",
};

const BAR_COUNT = 60;
const PARTIAL_OUTAGE_DOWNTIME_WEIGHT = 0.3;

type DayStatus = {
	color: string;
	hasIncident: boolean;
	incidentTitle?: string;
	impact?: "partial" | "major";
};

type TimeInterval = {
	start: number;
	end: number;
};

type ServiceIncidentSegment = {
	startMs: number;
	endMs: number;
	impact: "partial" | "major";
	title: string;
};

type DowntimeStats = {
	weightedDowntimeMs: number;
	hasIncident: boolean;
	impact?: "partial" | "major";
	incidentTitle?: string;
};

function normalizeImpact(impact?: string | null): string {
	if (!impact) return "degraded";
	if (impact === "partial") return "partial_outage";
	if (impact === "major") return "major_outage";
	return impact;
}

function renderStatusVersionPollingScript(statusApiPath: string, initialVersion: string): string {
	return `<script>
		(function () {
			const statusApiPath = ${JSON.stringify(statusApiPath)};
			let currentVersion = ${JSON.stringify(initialVersion)};

			const parseVersion = (version) => {
				if (typeof version !== "string") return null;
				const [timestampPart, activePart, updatesPart, totalPart] = version.split("-");
				const timestamp = Number(timestampPart);
				const active = Number(activePart);
				const updates = Number(updatesPart);
				const total = Number(totalPart);
				if (![timestamp, active, updates, total].every((value) => Number.isFinite(value))) {
					return null;
				}
				return { timestamp, active, updates, total };
			};

			const shouldReload = (nextVersion) => {
				if (nextVersion === currentVersion) return false;

				const currentParsed = parseVersion(currentVersion);
				const nextParsed = parseVersion(nextVersion);

				if (!currentParsed || !nextParsed) {
					return true;
				}

				if (nextParsed.timestamp < currentParsed.timestamp) {
					return false;
				}

				if (nextParsed.timestamp !== currentParsed.timestamp) return true;
				if (nextParsed.active !== currentParsed.active) return true;
				if (nextParsed.updates !== currentParsed.updates) return true;
				if (nextParsed.total !== currentParsed.total) return true;
				return false;
			};

			const poll = async () => {
				try {
					const response = await fetch(statusApiPath, { credentials: "omit" });
					if (response.status === 304) return;
					if (!response.ok) return;
					const payload = await response.json();
					const nextVersion = typeof payload?.version === "string" ? payload.version : null;
					if (!nextVersion) return;
					if (shouldReload(nextVersion)) {
						window.location.reload();
						return;
					}
					const currentParsed = parseVersion(currentVersion);
					const nextParsed = parseVersion(nextVersion);
					if (!currentParsed || !nextParsed || nextParsed.timestamp >= currentParsed.timestamp) {
						currentVersion = nextVersion;
					}
				} catch {}
			};

			window.setInterval(poll, 60_000);
		})();
	</script>`;
}

function getLatestUpdatesByAffectionId(updates: StatusPageAffectionUpdate[]): Map<string, StatusPageAffectionUpdate> {
	const latestByAffectionId = new Map<string, StatusPageAffectionUpdate>();
	for (const update of updates) {
		const existing = latestByAffectionId.get(update.affectionId);
		if (!existing || update.createdAt.getTime() > existing.createdAt.getTime()) {
			latestByAffectionId.set(update.affectionId, update);
		}
	}
	return latestByAffectionId;
}

function buildServiceIncidentSegments(data: StatusPagePublicData, nowMs: number): Map<string, ServiceIncidentSegment[]> {
	const byServiceId = new Map<string, ServiceIncidentSegment[]>();
	for (const affection of data.affections) {
		const startMs = affection.createdAt.getTime();
		const endMs = affection.resolvedAt ? affection.resolvedAt.getTime() : nowMs;
		for (const service of affection.services) {
			const list = byServiceId.get(service.id);
			const segment: ServiceIncidentSegment = {
				startMs,
				endMs,
				impact: service.impact,
				title: affection.title,
			};
			if (list) {
				list.push(segment);
			} else {
				byServiceId.set(service.id, [segment]);
			}
		}
	}
	return byServiceId;
}

function mergeIntervals(intervals: TimeInterval[]): TimeInterval[] {
	if (intervals.length === 0) {
		return [];
	}
	const sorted = [...intervals].sort((a, b) => a.start - b.start);
	const merged: TimeInterval[] = [{ ...sorted[0] }];
	for (const interval of sorted.slice(1)) {
		const last = merged[merged.length - 1];
		if (interval.start > last.end) {
			merged.push({ ...interval });
		} else {
			last.end = Math.max(last.end, interval.end);
		}
	}
	return merged;
}

function getMergedDurationMs(intervals: TimeInterval[]): number {
	return intervals.reduce((acc, interval) => acc + (interval.end - interval.start), 0);
}

function getOverlapDurationMs(a: TimeInterval[], b: TimeInterval[]): number {
	let i = 0;
	let j = 0;
	let overlap = 0;
	while (i < a.length && j < b.length) {
		const start = Math.max(a[i].start, b[j].start);
		const end = Math.min(a[i].end, b[j].end);
		if (end > start) {
			overlap += end - start;
		}
		if (a[i].end <= b[j].end) {
			i++;
		} else {
			j++;
		}
	}
	return overlap;
}

function getDowntimeStats(segments: ServiceIncidentSegment[], startMs: number, endMs: number): DowntimeStats {
	if (endMs <= startMs) {
		return { weightedDowntimeMs: 0, hasIncident: false };
	}

	const majorIntervals: TimeInterval[] = [];
	const partialIntervals: TimeInterval[] = [];
	let majorTitle: { title: string; overlapMs: number } | null = null;
	let partialTitle: { title: string; overlapMs: number } | null = null;

	for (const segment of segments) {
		const clippedStart = Math.max(segment.startMs, startMs);
		const clippedEnd = Math.min(segment.endMs, endMs);
		if (clippedEnd <= clippedStart) continue;

		const overlapMs = clippedEnd - clippedStart;
		if (segment.impact === "major") {
			majorIntervals.push({ start: clippedStart, end: clippedEnd });
			if (!majorTitle || overlapMs > majorTitle.overlapMs) {
				majorTitle = { title: segment.title, overlapMs };
			}
		} else {
			partialIntervals.push({ start: clippedStart, end: clippedEnd });
			if (!partialTitle || overlapMs > partialTitle.overlapMs) {
				partialTitle = { title: segment.title, overlapMs };
			}
		}
	}

	const mergedMajor = mergeIntervals(majorIntervals);
	const mergedPartial = mergeIntervals(partialIntervals);
	const majorDurationMs = getMergedDurationMs(mergedMajor);
	const partialDurationMs = getMergedDurationMs(mergedPartial);
	const partialOverlapWithMajorMs = getOverlapDurationMs(mergedPartial, mergedMajor);
	const partialOnlyDurationMs = Math.max(0, partialDurationMs - partialOverlapWithMajorMs);
	const weightedDowntimeMs = majorDurationMs + partialOnlyDurationMs * PARTIAL_OUTAGE_DOWNTIME_WEIGHT;

	if (majorDurationMs > 0) {
		return {
			weightedDowntimeMs,
			hasIncident: true,
			impact: "major",
			incidentTitle: majorTitle?.title,
		};
	}
	if (partialDurationMs > 0) {
		return {
			weightedDowntimeMs,
			hasIncident: true,
			impact: "partial",
			incidentTitle: partialTitle?.title,
		};
	}
	return { weightedDowntimeMs: 0, hasIncident: false };
}

function getBarColorClass(uptimePercent: number): string {
	if (uptimePercent >= 100) return STATUS_COLORS.operational.bar;
	if (uptimePercent >= 99) return STATUS_COLORS.degraded.bar;
	if (uptimePercent >= 95) return STATUS_COLORS.partial_outage.bar;
	return STATUS_COLORS.major_outage.bar;
}

export function renderStatusPageHtml(data: StatusPagePublicData, timestamp: number, basePath = ""): string {
	const { page, services, affections, updates } = data;
	const logoUrl = page.logoUrl || page.clientImage;
	const faviconUrl = page.faviconUrl;
	const displayMode = page.serviceDisplayMode || "bars_percentage";
	const historyFeedPaths = {
		rss: `${basePath}/feed.rss`,
		atom: `${basePath}/feed.atom`,
	};
	const subscribePopover = renderSubscribePopover({ feedPaths: historyFeedPaths, supportUrl: page.supportUrl });

	const now = new Date(timestamp);
	const nowMs = now.getTime();
	const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const statusApiPath = `${basePath}/api/status`;

	const activeAffections = affections.filter((affection) => !affection.resolvedAt);
	const hasIssues = activeAffections.length > 0;
	const { version: liveStatusVersion } = computeLiveStatusInfo(data, timestamp);
	const latestUpdateByAffectionId = getLatestUpdatesByAffectionId(updates);
	const serviceIncidentSegmentsByServiceId = buildServiceIncidentSegments(data, nowMs);

	const serviceNameById = new Map<string, string>();
	for (const service of services) {
		serviceNameById.set(service.id, service.name);
	}

	const activeStatusByServiceId = new Map<string, string>();
	for (const affection of activeAffections) {
		for (const service of affection.services) {
			if (!activeStatusByServiceId.has(service.id)) {
				activeStatusByServiceId.set(service.id, normalizeImpact(service.impact));
			}
		}
	}

	const formatRelativeTime = (date: Date): string => renderLocalizedRelativeTime(date, now);
	const formatTooltipDate = (date: Date): string => renderLocalizedTime(date, "date-weekday");

	const getServiceStatus = (serviceId: string) => activeStatusByServiceId.get(serviceId) ?? "operational";

	const getLastUpdate = (affectionId: string) => {
		return latestUpdateByAffectionId.get(affectionId) ?? null;
	};

	const getAffectionSeverity = (affection: StatusPagePublicData["affections"][number]): "partial" | "major" => {
		return affection.services.some((service) => service.impact === "major") ? "major" : "partial";
	};

	const renderActiveIncidents = (): string => {
		if (!hasIssues) {
			return `
				<div class="rounded-lg bg-emerald-50 border border-emerald-200 p-4 mb-8">
					<div class="flex items-center justify-center gap-2">
						<div class="w-2.5 h-2.5 rounded-full bg-emerald-500"></div>
						<span class="text-emerald-700 font-medium">All systems operational</span>
					</div>
				</div>`;
		}

		const sortedActiveAffections = [...activeAffections].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

		const incidentCards = sortedActiveAffections
			.map((affection) => {
				const severity = getAffectionSeverity(affection);
				const colors = SEVERITY_COLORS[severity];
				const lastUpdate = getLastUpdate(affection.id);
				const affectedServiceNames = affection.services.map((service) => serviceNameById.get(service.id) ?? "Unknown").slice(0, 3);
				const moreCount = affection.services.length - 3;

				return `
					<a href="${basePath}/history/${affection.id}" class="block rounded-lg border ${colors.border} ${colors.bg} p-4 hover:shadow-md transition-shadow">
						<div class="flex items-start justify-between gap-3">
							<div class="flex-1 min-w-0">
								<h3 class="text-sm font-medium text-slate-900">${escapeHtml(affection.title)}</h3>
								<p class="text-xs text-slate-500 mt-1">Started ${formatRelativeTime(affection.createdAt)}</p>
								${
									lastUpdate
										? `<p class="text-xs text-slate-500 mt-2">
											<span class="font-medium ${colors.text}">${UPDATE_STATUS_LABELS[lastUpdate.status ?? ""] || "Update"}:</span>
											<span class="text-slate-400 ml-1">${formatRelativeTime(lastUpdate.createdAt)}</span>
										</p>
										<p class="text-xs text-slate-400 mt-1 line-clamp-2">${escapeHtml(lastUpdate.message || "")}</p>`
										: ""
								}
							</div>
							<div class="flex flex-col items-end gap-2 shrink-0">
								<div class="flex items-center gap-1.5">
									<div class="w-2 h-2 rounded-full ${colors.dot}"></div>
									<span class="text-xs ${colors.text}">${SEVERITY_LABELS[severity]}</span>
								</div>
								<div class="flex items-center gap-1 flex-wrap justify-end">
									${affectedServiceNames.map((name) => `<span class="text-xs text-slate-400 bg-white/60 px-1.5 py-0.5 rounded">${escapeHtml(name)}</span>`).join("")}
									${moreCount > 0 ? `<span class="text-xs text-slate-400">+${moreCount}</span>` : ""}
								</div>
							</div>
						</div>
					</a>`;
			})
			.join("");

		return `
			<div class="mb-8 space-y-3">
				<div class="flex items-center gap-2 mb-3">
					<div class="w-2 h-2 rounded-full bg-orange-500 animate-pulse"></div>
					<span class="text-sm font-medium text-slate-700">Active Incidents</span>
				</div>
				${incidentCards}
			</div>`;
	};

	const getDayStatus = (serviceId: string, dayDate: Date): DayStatus => {
		const dayStart = new Date(dayDate);
		const dayEnd = new Date(dayDate);
		dayEnd.setDate(dayEnd.getDate() + 1);
		const dayRangeEnd = dayEnd > now ? now : dayEnd;
		const segments = serviceIncidentSegmentsByServiceId.get(serviceId) ?? [];
		const downtimeStats = getDowntimeStats(segments, dayStart.getTime(), dayRangeEnd.getTime());
		if (downtimeStats.hasIncident) {
			const dayDurationMs = dayRangeEnd.getTime() - dayStart.getTime();
			const uptimePercent = dayDurationMs > 0 ? ((dayDurationMs - downtimeStats.weightedDowntimeMs) / dayDurationMs) * 100 : 100;
			return {
				color: getBarColorClass(Math.max(0, Math.min(100, uptimePercent))),
				hasIncident: true,
				incidentTitle: downtimeStats.incidentTitle,
				impact: downtimeStats.impact,
			};
		}
		return { color: "bg-emerald-500", hasIncident: false };
	};

	const generateUptimeBars = (serviceId: string, serviceCreatedAt: Date | null) => {
		const addedDate = serviceCreatedAt ? new Date(serviceCreatedAt) : now;
		const serviceAddedDay = new Date(addedDate.getFullYear(), addedDate.getMonth(), addedDate.getDate());
		const bars: string[] = [];

		for (let i = BAR_COUNT - 1; i >= 0; i--) {
			const dayDate = new Date(startOfToday);
			dayDate.setDate(dayDate.getDate() - i);
			const formattedDate = formatTooltipDate(dayDate);

			if (dayDate < serviceAddedDay) {
				bars.push(`
					<div class="uptime-bar flex-1 h-4 rounded-sm bg-slate-200 min-w-0.75 cursor-pointer">
						<div class="uptime-tooltip">
							<div class="tooltip-date">${formattedDate}</div>
							<div class="tooltip-status tooltip-none">
								<svg class="tooltip-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
									<circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="2" fill="none"/>
								</svg>
								<span>No data</span>
							</div>
						</div>
					</div>`);
			} else {
				const dayStatus = getDayStatus(serviceId, dayDate);
				const tooltipStatusClass = dayStatus.hasIncident ? (dayStatus.impact === "major" ? "tooltip-major" : "tooltip-partial") : "tooltip-operational";
				const tooltipIcon = dayStatus.hasIncident
					? `<svg class="tooltip-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
							<path d="M8 0C3.589 0 0 3.589 0 8C0 12.411 3.589 16 8 16C12.411 16 16 12.411 16 8C16 3.589 12.411 0 8 0ZM7 4C7 3.448 7.447 3 8 3C8.553 3 9 3.448 9 4V9C9 9.552 8.553 10 8 10C7.447 10 7 9.552 7 9V4ZM8 13C7.447 13 7 12.552 7 12C7 11.448 7.447 11 8 11C8.553 11 9 11.448 9 12C9 12.552 8.553 13 8 13Z" fill="currentColor"/>
						</svg>`
					: `<svg class="tooltip-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
							<path d="M8 0C3.589 0 0 3.589 0 8C0 12.411 3.589 16 8 16C12.411 16 16 12.411 16 8C16 3.589 12.411 0 8 0ZM11.947 5.641C10.088 7.023 8.512 8.931 7.264 11.31C7.135 11.557 6.879 11.712 6.6 11.712C6.323 11.715 6.062 11.555 5.933 11.305C5.358 10.188 4.715 9.28 3.968 8.529C3.676 8.236 3.677 7.76 3.971 7.468C4.263 7.176 4.739 7.176 5.032 7.471C5.605 8.047 6.122 8.699 6.595 9.443C7.834 7.398 9.329 5.717 11.053 4.436C11.385 4.19 11.855 4.258 12.102 4.591C12.349 4.923 12.28 5.394 11.947 5.641Z" fill="currentColor"/>
						</svg>`;
				const tooltipText = dayStatus.hasIncident ? escapeHtml(dayStatus.incidentTitle || "Incident") : "No incidents";

				bars.push(`
					<div class="uptime-bar flex-1 h-4 rounded-sm ${dayStatus.color} min-w-0.75 cursor-pointer">
						<div class="uptime-tooltip">
							<div class="tooltip-date">${formattedDate}</div>
							<div class="tooltip-status ${tooltipStatusClass}">
								${tooltipIcon}
								<span>${tooltipText}</span>
							</div>
						</div>
					</div>`);
			}
		}

		return `<div class="flex gap-0.5 mt-2">${bars.join("")}</div>`;
	};

	const calculateUptime = (serviceId: string, serviceCreatedAt: Date | null): number => {
		const windowStart = new Date(startOfToday);
		windowStart.setDate(windowStart.getDate() - (BAR_COUNT - 1));
		const addedDate = serviceCreatedAt ? new Date(serviceCreatedAt) : windowStart;
		const measurementStart = addedDate > windowStart ? addedDate : windowStart;
		const measurementEnd = now;

		if (measurementEnd <= measurementStart) {
			return 100;
		}

		const segments = serviceIncidentSegmentsByServiceId.get(serviceId) ?? [];
		const downtimeStats = getDowntimeStats(segments, measurementStart.getTime(), measurementEnd.getTime());
		const downtimeMs = downtimeStats.weightedDowntimeMs;
		const totalMs = measurementEnd.getTime() - measurementStart.getTime();
		if (totalMs <= 0) {
			return 100;
		}

		const uptime = ((totalMs - downtimeMs) / totalMs) * 100;
		return Math.round(Math.max(0, Math.min(100, uptime)) * 100) / 100;
	};

	const servicesHtml = services
		.map((service) => {
			const status = getServiceStatus(service.id);
			const colors = STATUS_COLORS[status] || STATUS_COLORS.operational;
			const label = STATUS_LABELS[status] || "Operational";
			const showBars = displayMode === "bars" || displayMode === "bars_percentage";
			const showPercentage = displayMode === "bars_percentage";
			const uptime = calculateUptime(service.id, service.createdAt);
			const hasDescription = !!service.description?.trim();

			return `
					<div class="rounded-lg border border-slate-200 bg-white p-4">
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-1.5">
								<span class="text-sm font-medium text-slate-900">${escapeHtml(service.name?.trim() || "Untitled service")}</span>
								${
									hasDescription
										? `<div class="service-info-tooltip">
											<button type="button" class="service-info-btn" tabindex="0" aria-label="More information about ${escapeHtml(service.name?.trim() || "this service")}">?</button>
											<div class="service-info-content">${escapeHtml(service.description!)}</div>
										</div>`
										: ""
								}
							</div>
							<div class="flex items-center gap-2">
									${showPercentage ? `<span class="text-xs text-slate-400">${uptime}% uptime</span>` : ""}
								<div class="flex items-center gap-1.5">
									<div class="w-2 h-2 rounded-full ${colors.dot}"></div>
									<span class="text-xs ${colors.text}">${label}</span>
								</div>
							</div>
						</div>
						${showBars ? generateUptimeBars(service.id, service.createdAt) : ""}
					</div>
				`;
		})
		.join("");

	const footerLinks = [];
	if (page.privacyPolicyUrl) {
		footerLinks.push(`<a href="${escapeHtml(page.privacyPolicyUrl)}" class="hover:text-slate-500 transition-colors">Privacy Policy</a>`);
	}
	if (page.termsOfServiceUrl) {
		footerLinks.push(`<a href="${escapeHtml(page.termsOfServiceUrl)}" class="hover:text-slate-500 transition-colors">Terms of Service</a>`);
	}
	const footerLinksHtml = footerLinks.length > 0 ? footerLinks.join('<span class="mx-2">&middot;</span>') : "";

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${escapeHtml(page.name)}</title>
	${faviconUrl ? `<link rel="icon" href="${escapeHtml(faviconUrl)}">` : ""}
	<link rel="alternate" type="application/rss+xml" title="RSS - ${escapeHtml(page.name)}" href="${historyFeedPaths.rss}">
	<link rel="alternate" type="application/atom+xml" title="Atom - ${escapeHtml(page.name)}" href="${historyFeedPaths.atom}">
	<script src="https://cdn.tailwindcss.com"></script>
	<style>
		body {
			font-family: ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
		}
		.uptime-bar {
			position: relative;
		}
		.uptime-tooltip {
			position: absolute;
			top: calc(100% + 8px);
			left: 50%;
			transform: translateX(-50%);
			background: white;
			border: 1px solid #e2e8f0;
			border-radius: 8px;
			padding: 8px 12px;
			box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
			white-space: nowrap;
			z-index: 50;
			opacity: 0;
			visibility: hidden;
			transition: opacity 0.15s, visibility 0.15s;
			pointer-events: none;
		}
		.uptime-tooltip::before {
			content: '';
			position: absolute;
			bottom: 100%;
			left: 50%;
			transform: translateX(-50%);
			border: 6px solid transparent;
			border-bottom-color: #e2e8f0;
		}
		.uptime-tooltip::after {
			content: '';
			position: absolute;
			bottom: 100%;
			left: 50%;
			transform: translateX(-50%);
			border: 5px solid transparent;
			border-bottom-color: white;
		}
		.uptime-bar:hover .uptime-tooltip {
			opacity: 1;
			visibility: visible;
		}
		.tooltip-date {
			font-size: 12px;
			color: #94a3b8;
			padding-bottom: 6px;
			border-bottom: 1px solid #f1f5f9;
			margin-bottom: 6px;
		}
		.tooltip-status {
			display: flex;
			align-items: center;
			gap: 8px;
			font-size: 13px;
		}
		.tooltip-icon {
			width: 16px;
			height: 16px;
			flex-shrink: 0;
		}
		.tooltip-operational {
			color: #10b981;
		}
		.tooltip-partial {
			color: #f97316;
		}
		.tooltip-major {
			color: #ef4444;
		}
		.tooltip-none {
			color: #94a3b8;
		}
		/* Prevent tooltip from overflowing on edges */
		.uptime-bar:first-child .uptime-tooltip {
			left: 0;
			transform: translateX(0);
		}
		.uptime-bar:first-child .uptime-tooltip::before,
		.uptime-bar:first-child .uptime-tooltip::after {
			left: 12px;
			transform: translateX(0);
		}
		.uptime-bar:last-child .uptime-tooltip {
			left: auto;
			right: 0;
			transform: translateX(0);
		}
		.uptime-bar:last-child .uptime-tooltip::before,
		.uptime-bar:last-child .uptime-tooltip::after {
			left: auto;
			right: 12px;
			transform: translateX(0);
		}
		/* Service info tooltip */
		.service-info-tooltip {
			position: relative;
			display: inline-flex;
		}
		.service-info-btn {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: 16px;
			height: 16px;
			font-size: 11px;
			font-weight: 600;
			color: #64748b;
			background: #f1f5f9;
			border: 1px solid #e2e8f0;
			border-radius: 50%;
			cursor: pointer;
			transition: all 0.15s;
		}
		.service-info-btn:hover,
		.service-info-btn:focus {
			color: #475569;
			background: #e2e8f0;
			border-color: #cbd5e1;
			outline: none;
		}
		.service-info-content {
			position: absolute;
			top: calc(100% + 8px);
			left: 50%;
			transform: translateX(-50%);
			background: white;
			border: 1px solid #e2e8f0;
			border-radius: 8px;
			padding: 8px 12px;
			box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
			white-space: normal;
			max-width: 250px;
			min-width: 150px;
			z-index: 50;
			opacity: 0;
			visibility: hidden;
			transition: opacity 0.15s, visibility 0.15s;
			pointer-events: none;
			font-size: 13px;
			color: #475569;
			line-height: 1.4;
		}
		.service-info-content::before {
			content: '';
			position: absolute;
			bottom: 100%;
			left: 50%;
			transform: translateX(-50%);
			border: 6px solid transparent;
			border-bottom-color: #e2e8f0;
		}
		.service-info-content::after {
			content: '';
			position: absolute;
			bottom: 100%;
			left: 50%;
			transform: translateX(-50%);
			border: 5px solid transparent;
			border-bottom-color: white;
		}
		.service-info-tooltip:hover .service-info-content,
		.service-info-btn:focus + .service-info-content {
			opacity: 1;
			visibility: visible;
		}
		.subscribe-tab[data-active="true"] {
			border-bottom-color: #0f172a;
			color: #0f172a;
		}
		.subscribe-tab[data-active="false"] {
			border-bottom-color: transparent;
			color: #64748b;
		}
		.subscribe-tab[data-active="false"]:hover {
			color: #0f172a;
		}
	</style>
</head>
<body class="bg-linear-to-b from-slate-50 to-white min-h-screen flex flex-col">
	<div class="flex-1 max-w-2xl mx-auto px-4 py-12 md:py-16 w-full">
		<header class="flex items-center justify-between mb-8">
			<div class="flex items-center gap-3">
				${
					logoUrl
						? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(page.name)}" class="w-12 h-12 object-contain rounded-xl">`
						: `<div class="w-12 h-12 rounded-xl bg-linear-to-br from-slate-100 to-slate-50 border border-slate-200 flex items-center justify-center">
						<svg class="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
						</svg>
					</div>`
				}
				<div class="text-lg font-semibold text-slate-900">${escapeHtml(page.name)}</div>
			</div>
			<div class="relative">
				<button type="button" data-subscribe-toggle class="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
					Subscribe to updates
				</button>
				${subscribePopover}
			</div>
		</header>

		${renderActiveIncidents()}

		${
			services.length > 0
				? `<div class="space-y-3">${servicesHtml}</div>`
				: `<div class="rounded-lg border border-dashed border-slate-300 p-8 text-center">
				<p class="text-sm text-slate-500">No services configured</p>
			</div>`
		}
	</div>

	<footer class="max-w-2xl mx-auto px-4 pb-8 w-full">
		<div class="pt-8 border-t border-slate-200 space-y-3">
			<div class="flex items-center justify-between text-xs text-slate-400">
				<a href="${basePath}/history" class="hover:text-slate-500 transition-colors">&larr; Incident History</a>
				<a href="${POWERED_BY_URL}" class="flex items-center gap-1.5 hover:text-slate-500 transition-colors">
					Powered by
					<svg class="w-3.5 h-3.5 text-orange-500" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
						<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>
					</svg>
				</a>
			</div>
			${footerLinksHtml ? `<div class="flex items-center justify-center text-xs text-slate-400">${footerLinksHtml}</div>` : ""}
		</div>
	</footer>
	${renderLocaleDateScript()}
	${renderStatusVersionPollingScript(statusApiPath, liveStatusVersion)}
</body>
</html>`;
}

export function buildStatusPageResponse(data: StatusPagePublicData, basePath = ""): Response {
	const html = renderStatusPageHtml(data, Date.now(), basePath);
	return new Response(html, {
		status: 200,
		headers: {
			"Content-Type": "text/html; charset=utf-8",
			"Cache-Control": "public, max-age=30, stale-while-revalidate=60",
		},
	});
}
