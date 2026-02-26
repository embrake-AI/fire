import { escapeHtml, formatDate, formatDateTime, POWERED_BY_URL, renderBaseHtml, renderHtmlAutoRefreshScript, renderSubscribePopover } from "./status-pages.render.shared";
import type { IncidentDetailData, IncidentHistoryData } from "./status-pages.server";

const SEVERITY_COLORS = {
	partial: { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200", dot: "bg-orange-500" },
	major: { bg: "bg-red-50", text: "text-red-700", border: "border-red-200", dot: "bg-red-500" },
};

const SEVERITY_LABELS = {
	partial: "Partial Outage",
	major: "Major Outage",
};

const UPDATE_STATUS_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
	investigating: { bg: "bg-yellow-50", text: "text-yellow-700", dot: "bg-yellow-500" },
	mitigating: { bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-500" },
	resolved: { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
};

const UPDATE_STATUS_LABELS: Record<string, string> = {
	investigating: "Investigating",
	mitigating: "Mitigating",
	resolved: "Resolved",
};

function renderIncidentHistoryHtml(data: IncidentHistoryData, basePath = ""): string {
	const { page, incidents } = data;
	const logoUrl = page.logoUrl || page.clientImage;

	const incidentsHtml =
		incidents.length > 0
			? incidents
					.map((incident) => {
						const colors = SEVERITY_COLORS[incident.severity];
						const isResolved = !!incident.resolvedAt;
						const dateRange = isResolved ? `${formatDate(incident.createdAt)} - ${formatDate(incident.resolvedAt!)}` : `Started ${formatDate(incident.createdAt)}`;

						return `
				<a href="${basePath}/history/${incident.id}" class="block rounded-lg border ${isResolved ? "border-slate-200 bg-white" : `${colors.border} ${colors.bg}`} p-4 hover:shadow-md transition-shadow">
					<div class="flex items-start justify-between gap-4">
						<div class="flex-1 min-w-0">
							<h3 class="text-sm font-medium text-slate-900 truncate">${escapeHtml(incident.title)}</h3>
							<p class="text-xs text-slate-500 mt-1">${dateRange}</p>
							${
								incident.lastUpdate
									? `<p class="text-xs text-slate-400 mt-2 line-clamp-2">
								<span class="font-medium">${UPDATE_STATUS_LABELS[incident.lastUpdate.status ?? ""] || "Update"}:</span>
								${escapeHtml(incident.lastUpdate.message || "No message")}
							</p>`
									: ""
							}
						</div>
						<div class="flex items-center gap-2 shrink-0">
							<div class="flex items-center gap-1.5">
								<div class="w-2 h-2 rounded-full ${colors.dot}"></div>
								<span class="text-xs ${colors.text}">${SEVERITY_LABELS[incident.severity]}</span>
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
		content: `${content}${renderHtmlAutoRefreshScript(60_000)}`,
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
	const feedPaths = {
		rss: `${basePath}/feed.rss`,
		atom: `${basePath}/feed.atom`,
	};

	const colors = SEVERITY_COLORS[incident.severity];

	const affectedServicesHtml = incident.affectedServices
		.map((service) => {
			const impactColors = service.impact === "major" ? SEVERITY_COLORS.major : SEVERITY_COLORS.partial;
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
						const updateColors = UPDATE_STATUS_COLORS[update.status ?? ""] || { bg: "bg-slate-50", text: "text-slate-700", dot: "bg-slate-400" };
						const updateLabel = UPDATE_STATUS_LABELS[update.status ?? ""] || "Update";
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

	const _subscribePopover = renderSubscribePopover({ feedPaths, supportUrl: page.supportUrl });
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
						<span class="text-xs ${colors.text}">${SEVERITY_LABELS[incident.severity]}</span>
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
		head: `
			<link rel="alternate" type="application/rss+xml" title="RSS - ${escapeHtml(incident.title)}" href="${feedPaths.rss}">
			<link rel="alternate" type="application/atom+xml" title="Atom - ${escapeHtml(incident.title)}" href="${feedPaths.atom}">
			<style>
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
		`,
		content: `${content}${isResolved ? "" : renderHtmlAutoRefreshScript(30_000)}`,
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
