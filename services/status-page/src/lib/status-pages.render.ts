import type { IncidentDetailData, IncidentHistoryData, StatusPageAffection, StatusPagePublicData } from "./status-pages.server";

const POWERED_BY_URL = process.env.VITE_APP_URL ?? "";

function escapeHtml(text: string | null | undefined): string {
	if (!text) return "";
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

export function renderStatusPageHtml(data: StatusPagePublicData, timestamp: number, basePath = ""): string {
	const { page, services, affections, updates } = data;
	const logoUrl = page.logoUrl || page.clientImage;
	const faviconUrl = page.faviconUrl;
	const displayMode = page.serviceDisplayMode || "bars_percentage";

	const now = new Date(timestamp);
	const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

	const activeAffections = affections.filter((a) => !a.resolvedAt);
	const hasIssues = activeAffections.length > 0;

	const normalizeImpact = (impact?: string | null) => {
		if (!impact) return "degraded";
		if (impact === "partial") return "partial_outage";
		if (impact === "major") return "major_outage";
		return impact;
	};

	const getServiceStatus = (serviceId: string) => {
		for (const affection of activeAffections) {
			const affected = affection.services.find((s) => s.id === serviceId);
			if (affected) {
				return normalizeImpact(affected.impact);
			}
		}
		return "operational";
	};

	const statusColors: Record<string, { bg: string; text: string; dot: string; bar: string }> = {
		operational: { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500", bar: "bg-emerald-500" },
		degraded: { bg: "bg-yellow-50", text: "text-yellow-700", dot: "bg-yellow-500", bar: "bg-yellow-500" },
		partial_outage: { bg: "bg-orange-50", text: "text-orange-700", dot: "bg-orange-500", bar: "bg-orange-500" },
		major_outage: { bg: "bg-red-50", text: "text-red-700", dot: "bg-red-500", bar: "bg-red-500" },
	};

	const statusLabels: Record<string, string> = {
		operational: "Operational",
		degraded: "Degraded Performance",
		partial_outage: "Partial Outage",
		major_outage: "Major Outage",
	};

	const severityColors = {
		partial: { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200", dot: "bg-orange-500" },
		major: { bg: "bg-red-50", text: "text-red-700", border: "border-red-200", dot: "bg-red-500" },
	};

	const severityLabels = {
		partial: "Partial Outage",
		major: "Major Outage",
	};

	const updateStatusLabels: Record<string, string> = {
		investigating: "Investigating",
		mitigating: "Mitigating",
		resolved: "Resolved",
	};

	const formatRelativeTime = (date: Date): string => {
		const diffMs = now.getTime() - new Date(date).getTime();
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMs / 3600000);
		const diffDays = Math.floor(diffMs / 86400000);

		if (diffMins < 1) return "just now";
		if (diffMins < 60) return `${diffMins}m ago`;
		if (diffHours < 24) return `${diffHours}h ago`;
		if (diffDays === 1) return "yesterday";
		return `${diffDays}d ago`;
	};

	const getLastUpdate = (affectionId: string) => {
		const affectionUpdates = updates
			.filter((u) => u.affectionId === affectionId)
			.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
		return affectionUpdates[0] ?? null;
	};

	const getAffectionSeverity = (affection: StatusPageAffection): "partial" | "major" => {
		return affection.services.some((s) => s.impact === "major") ? "major" : "partial";
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

		const sortedActiveAffections = [...activeAffections].sort(
			(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
		);

		const incidentCards = sortedActiveAffections
			.map((affection) => {
				const severity = getAffectionSeverity(affection);
				const colors = severityColors[severity];
				const lastUpdate = getLastUpdate(affection.id);
				const affectedServiceNames = affection.services
					.map((s) => services.find((svc) => svc.id === s.id)?.name ?? "Unknown")
					.slice(0, 3);
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
											<span class="font-medium ${colors.text}">${updateStatusLabels[lastUpdate.status ?? ""] || "Update"}:</span>
											<span class="text-slate-400 ml-1">${formatRelativeTime(lastUpdate.createdAt)}</span>
										</p>
										<p class="text-xs text-slate-400 mt-1 line-clamp-2">${escapeHtml(lastUpdate.message || "")}</p>`
										: ""
								}
							</div>
							<div class="flex flex-col items-end gap-2 shrink-0">
								<div class="flex items-center gap-1.5">
									<div class="w-2 h-2 rounded-full ${colors.dot}"></div>
									<span class="text-xs ${colors.text}">${severityLabels[severity]}</span>
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

	const BAR_COUNT = 45;

	const formatTooltipDate = (date: Date): string => {
		return new Date(date).toLocaleDateString("en-US", {
			weekday: "short",
			month: "short",
			day: "numeric",
			year: "numeric",
		});
	};

	type DayStatus = {
		color: string;
		hasIncident: boolean;
		incidentTitle?: string;
		impact?: "partial" | "major";
	};

	const getDayStatus = (serviceId: string, dayDate: Date): DayStatus => {
		const dayStart = new Date(dayDate);
		const dayEnd = new Date(dayDate);
		dayEnd.setDate(dayEnd.getDate() + 1);

		for (const affection of affections) {
			const serviceImpact = affection.services.find((s) => s.id === serviceId);
			if (!serviceImpact) continue;

			const affectionStart = new Date(affection.createdAt);
			const affectionEnd = affection.resolvedAt ? new Date(affection.resolvedAt) : now;

			if (affectionStart < dayEnd && affectionEnd >= dayStart) {
				const impact = serviceImpact.impact;
				const normalizedImpact = normalizeImpact(impact);
				return {
					color: statusColors[normalizedImpact]?.bar || "bg-yellow-500",
					hasIncident: true,
					incidentTitle: affection.title,
					impact: impact,
				};
			}
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
				const tooltipStatusClass = dayStatus.hasIncident
					? dayStatus.impact === "major"
						? "tooltip-major"
						: "tooltip-partial"
					: "tooltip-operational";
				const tooltipIcon = dayStatus.hasIncident
					? `<svg class="tooltip-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
							<path d="M8 0C3.589 0 0 3.589 0 8C0 12.411 3.589 16 8 16C12.411 16 16 12.411 16 8C16 3.589 12.411 0 8 0ZM7 4C7 3.448 7.447 3 8 3C8.553 3 9 3.448 9 4V9C9 9.552 8.553 10 8 10C7.447 10 7 9.552 7 9V4ZM8 13C7.447 13 7 12.552 7 12C7 11.448 7.447 11 8 11C8.553 11 9 11.448 9 12C9 12.552 8.553 13 8 13Z" fill="currentColor"/>
						</svg>`
					: `<svg class="tooltip-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
							<path d="M8 0C3.589 0 0 3.589 0 8C0 12.411 3.589 16 8 16C12.411 16 16 12.411 16 8C16 3.589 12.411 0 8 0ZM11.947 5.641C10.088 7.023 8.512 8.931 7.264 11.31C7.135 11.557 6.879 11.712 6.6 11.712C6.323 11.715 6.062 11.555 5.933 11.305C5.358 10.188 4.715 9.28 3.968 8.529C3.676 8.236 3.677 7.76 3.971 7.468C4.263 7.176 4.739 7.176 5.032 7.471C5.605 8.047 6.122 8.699 6.595 9.443C7.834 7.398 9.329 5.717 11.053 4.436C11.385 4.19 11.855 4.258 12.102 4.591C12.349 4.923 12.28 5.394 11.947 5.641Z" fill="currentColor"/>
						</svg>`;
				const tooltipText = dayStatus.hasIncident
					? escapeHtml(dayStatus.incidentTitle || "Incident")
					: "No incidents";

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
		const addedDate = serviceCreatedAt ? new Date(serviceCreatedAt) : now;
		const serviceAddedDay = new Date(addedDate.getFullYear(), addedDate.getMonth(), addedDate.getDate());
		let totalDays = 0;
		let downtimeDays = 0;

		for (let i = BAR_COUNT - 1; i >= 0; i--) {
			const dayDate = new Date(startOfToday);
			dayDate.setDate(dayDate.getDate() - i);

			if (dayDate >= serviceAddedDay) {
				totalDays++;
				const dayStart = new Date(dayDate);
				const dayEnd = new Date(dayDate);
				dayEnd.setDate(dayEnd.getDate() + 1);

				for (const affection of affections) {
					const affectsService = affection.services.some((s) => s.id === serviceId);
					if (!affectsService) continue;

					const affectionStart = new Date(affection.createdAt);
					const affectionEnd = affection.resolvedAt ? new Date(affection.resolvedAt) : now;

					if (affectionStart < dayEnd && affectionEnd >= dayStart) {
						downtimeDays++;
						break;
					}
				}
			}
		}

		if (totalDays === 0) return 100;
		return Math.round(((totalDays - downtimeDays) / totalDays) * 1000) / 10;
	};

	const servicesHtml = services
		.map((service) => {
			const status = getServiceStatus(service.id);
			const colors = statusColors[status] || statusColors.operational;
			const label = statusLabels[status] || "Operational";
			const showBars = displayMode === "bars" || displayMode === "bars_percentage";
			const showPercentage = displayMode === "bars_percentage";
			const uptime = calculateUptime(service.id, service.createdAt);

			return `
					<div class="rounded-lg border border-slate-200 bg-white p-4">
						<div class="flex items-center justify-between">
							<span class="text-sm font-medium text-slate-900">${escapeHtml(service.name?.trim() || "Untitled service")}</span>
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
			<button class="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
				Subscribe to updates
			</button>
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

function renderBaseHtml(options: {
	title: string;
	faviconUrl?: string | null;
	content: string;
}): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${escapeHtml(options.title)}</title>
	${options.faviconUrl ? `<link rel="icon" href="${escapeHtml(options.faviconUrl)}">` : ""}
	<script src="https://cdn.tailwindcss.com"></script>
	<style>
		body {
			font-family: ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
		}
	</style>
</head>
<body class="bg-linear-to-b from-slate-50 to-white min-h-screen flex flex-col">
	${options.content}
</body>
</html>`;
}

function formatDate(date: Date): string {
	return new Date(date).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

function formatDateTime(date: Date): string {
	return new Date(date).toLocaleString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
}

function renderIncidentHistoryHtml(data: IncidentHistoryData, basePath = ""): string {
	const { page, incidents } = data;
	const logoUrl = page.logoUrl || page.clientImage;

	const severityColors = {
		partial: { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200", dot: "bg-orange-500" },
		major: { bg: "bg-red-50", text: "text-red-700", border: "border-red-200", dot: "bg-red-500" },
	};

	const severityLabels = {
		partial: "Partial Outage",
		major: "Major Outage",
	};

	const statusLabels: Record<string, string> = {
		investigating: "Investigating",
		mitigating: "Mitigating",
		resolved: "Resolved",
	};

	const incidentsHtml =
		incidents.length > 0
			? incidents
					.map((incident) => {
						const colors = severityColors[incident.severity];
						const isResolved = !!incident.resolvedAt;
						const dateRange = isResolved
							? `${formatDate(incident.createdAt)} - ${formatDate(incident.resolvedAt!)}`
							: `Started ${formatDate(incident.createdAt)}`;

						return `
				<a href="${basePath}/history/${incident.id}" class="block rounded-lg border ${isResolved ? "border-slate-200 bg-white" : `${colors.border} ${colors.bg}`} p-4 hover:shadow-md transition-shadow">
					<div class="flex items-start justify-between gap-4">
						<div class="flex-1 min-w-0">
							<h3 class="text-sm font-medium text-slate-900 truncate">${escapeHtml(incident.title)}</h3>
							<p class="text-xs text-slate-500 mt-1">${dateRange}</p>
							${
								incident.lastUpdate
									? `<p class="text-xs text-slate-400 mt-2 line-clamp-2">
								<span class="font-medium">${statusLabels[incident.lastUpdate.status ?? ""] || "Update"}:</span>
								${escapeHtml(incident.lastUpdate.message || "No message")}
							</p>`
									: ""
							}
						</div>
						<div class="flex items-center gap-2 shrink-0">
							<div class="flex items-center gap-1.5">
								<div class="w-2 h-2 rounded-full ${colors.dot}"></div>
								<span class="text-xs ${colors.text}">${severityLabels[incident.severity]}</span>
							</div>
							${isResolved ? '<span class="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded">Resolved</span>' : '<span class="text-xs text-orange-600 bg-orange-100 px-2 py-0.5 rounded">Active</span>'}
						</div>
					</div>
				</a>
			`;
					})
					.join("")
			: `<div class="rounded-lg border border-dashed border-slate-300 p-8 text-center">
			<p class="text-sm text-slate-500">No incidents recorded</p>
			<p class="text-xs text-slate-400 mt-1">All systems have been running smoothly</p>
		</div>`;

	const rootPath = basePath || "/";
	const content = `
	<div class="flex-1 max-w-2xl mx-auto px-4 py-12 md:py-16 w-full">
		<header class="flex items-center justify-between mb-8">
			<a href="${rootPath}" class="flex items-center gap-3 hover:opacity-80 transition-opacity">
				${
					logoUrl
						? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(page.name)}" class="w-10 h-10 object-contain rounded-xl">`
						: `<div class="w-10 h-10 rounded-xl bg-linear-to-br from-slate-100 to-slate-50 border border-slate-200 flex items-center justify-center">
						<svg class="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
						</svg>
					</div>`
				}
				<div class="text-base font-semibold text-slate-900">${escapeHtml(page.name)}</div>
			</a>
			<a href="${rootPath}" class="text-sm text-slate-500 hover:text-slate-700 transition-colors">&larr; Back to status</a>
		</header>

		<div class="mb-6">
			<h1 class="text-xl font-semibold text-slate-900">Incident History</h1>
			<p class="text-sm text-slate-500 mt-1">Past incidents affecting our services</p>
		</div>

		<div class="space-y-3">
			${incidentsHtml}
		</div>
	</div>

	<footer class="max-w-2xl mx-auto px-4 pb-8 w-full">
		<div class="pt-8 border-t border-slate-200">
			<div class="flex items-center justify-center text-xs text-slate-400">
				<a href="${POWERED_BY_URL}" class="flex items-center gap-1.5 hover:text-slate-500 transition-colors">
					Powered by
					<svg class="w-3.5 h-3.5 text-orange-500" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
						<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>
					</svg>
				</a>
			</div>
		</div>
	</footer>`;

	return renderBaseHtml({
		title: `Incident History - ${page.name}`,
		faviconUrl: page.faviconUrl,
		content,
	});
}

export function buildIncidentHistoryResponse(data: IncidentHistoryData, basePath = ""): Response {
	const html = renderIncidentHistoryHtml(data, basePath);
	return new Response(html, {
		status: 200,
		headers: {
			"Content-Type": "text/html; charset=utf-8",
			"Cache-Control": "public, max-age=30, stale-while-revalidate=60",
		},
	});
}

function renderIncidentDetailHtml(data: IncidentDetailData, basePath = ""): string {
	const { page, incident } = data;
	const logoUrl = page.logoUrl || page.clientImage;
	const isResolved = !!incident.resolvedAt;

	const severityColors = {
		partial: { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200", dot: "bg-orange-500" },
		major: { bg: "bg-red-50", text: "text-red-700", border: "border-red-200", dot: "bg-red-500" },
	};

	const severityLabels = {
		partial: "Partial Outage",
		major: "Major Outage",
	};

	const statusColors: Record<string, { bg: string; text: string; dot: string }> = {
		investigating: { bg: "bg-yellow-50", text: "text-yellow-700", dot: "bg-yellow-500" },
		mitigating: { bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-500" },
		resolved: { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
	};

	const statusLabels: Record<string, string> = {
		investigating: "Investigating",
		mitigating: "Mitigating",
		resolved: "Resolved",
	};

	const colors = severityColors[incident.severity];

	const affectedServicesHtml = incident.affectedServices
		.map((service) => {
			const impactColors = service.impact === "major" ? severityColors.major : severityColors.partial;
			return `<span class="inline-flex items-center gap-1.5 px-2 py-1 rounded-md ${impactColors.bg} ${impactColors.text} text-xs">
				<span class="w-1.5 h-1.5 rounded-full ${impactColors.dot}"></span>
				${escapeHtml(service.name)}
			</span>`;
		})
		.join("");

	const updatesHtml =
		incident.updates.length > 0
			? incident.updates
					.map((update) => {
						const updateColors = statusColors[update.status ?? ""] || { bg: "bg-slate-50", text: "text-slate-700", dot: "bg-slate-400" };
						const updateLabel = statusLabels[update.status ?? ""] || "Update";
						return `
				<div class="relative pl-6 pb-6 border-l-2 border-slate-200 last:border-transparent last:pb-0">
					<div class="absolute -left-1.5 top-0 w-3 h-3 rounded-full ${updateColors.dot}"></div>
					<div class="flex items-center gap-2 mb-1">
						<span class="text-xs font-medium ${updateColors.text}">${updateLabel}</span>
						<span class="text-xs text-slate-400">${formatDateTime(update.createdAt)}</span>
					</div>
					<p class="text-sm text-slate-600">${escapeHtml(update.message || "No details provided")}</p>
				</div>
			`;
					})
					.join("")
			: `<p class="text-sm text-slate-500">No updates posted yet</p>`;

	const rootPath = basePath || "/";
	const content = `
	<div class="flex-1 max-w-2xl mx-auto px-4 py-12 md:py-16 w-full">
		<header class="flex items-center justify-between mb-8">
			<a href="${rootPath}" class="flex items-center gap-3 hover:opacity-80 transition-opacity">
				${
					logoUrl
						? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(page.name)}" class="w-10 h-10 object-contain rounded-xl">`
						: `<div class="w-10 h-10 rounded-xl bg-linear-to-br from-slate-100 to-slate-50 border border-slate-200 flex items-center justify-center">
						<svg class="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
						</svg>
					</div>`
				}
				<div class="text-base font-semibold text-slate-900">${escapeHtml(page.name)}</div>
			</a>
			<a href="${basePath}/history" class="text-sm text-slate-500 hover:text-slate-700 transition-colors">&larr; All incidents</a>
		</header>

		<div class="rounded-lg ${isResolved ? "border border-slate-200 bg-white" : `${colors.border} ${colors.bg} border`} p-6 mb-6">
			<div class="flex items-start justify-between gap-4 mb-4">
				<h1 class="text-lg font-semibold text-slate-900">${escapeHtml(incident.title)}</h1>
				<div class="flex items-center gap-2 shrink-0">
					<div class="flex items-center gap-1.5">
						<div class="w-2 h-2 rounded-full ${colors.dot}"></div>
						<span class="text-xs ${colors.text}">${severityLabels[incident.severity]}</span>
					</div>
					${isResolved ? '<span class="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded">Resolved</span>' : '<span class="text-xs text-orange-600 bg-orange-100 px-2 py-0.5 rounded">Active</span>'}
				</div>
			</div>
			<div class="flex items-center gap-4 text-xs text-slate-500 mb-4">
				<span>Started: ${formatDateTime(incident.createdAt)}</span>
				${isResolved ? `<span>Resolved: ${formatDateTime(incident.resolvedAt!)}</span>` : ""}
			</div>
			<div class="flex flex-wrap gap-2">
				${affectedServicesHtml}
			</div>
		</div>

		<div class="mb-4">
			<h2 class="text-sm font-semibold text-slate-900 mb-4">Updates</h2>
			<div class="pl-2">
				${updatesHtml}
			</div>
		</div>
	</div>

	<footer class="max-w-2xl mx-auto px-4 pb-8 w-full">
		<div class="pt-8 border-t border-slate-200">
			<div class="flex items-center justify-center text-xs text-slate-400">
				<a href="${POWERED_BY_URL}" class="flex items-center gap-1.5 hover:text-slate-500 transition-colors">
					Powered by
					<svg class="w-3.5 h-3.5 text-orange-500" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
						<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>
					</svg>
				</a>
			</div>
		</div>
	</footer>`;

	return renderBaseHtml({
		title: `${incident.title} - ${page.name}`,
		faviconUrl: page.faviconUrl,
		content,
	});
}

export function buildIncidentDetailResponse(data: IncidentDetailData, isActive: boolean, basePath = ""): Response {
	const html = renderIncidentDetailHtml(data, basePath);
	const cacheControl = isActive ? "public, max-age=30, stale-while-revalidate=60" : "public, max-age=86400, stale-while-revalidate=3600";
	return new Response(html, {
		status: 200,
		headers: {
			"Content-Type": "text/html; charset=utf-8",
			"Cache-Control": cacheControl,
		},
	});
}
