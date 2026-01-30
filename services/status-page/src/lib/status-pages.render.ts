import type { StatusPagePublicData } from "./status-pages.server";

function escapeHtml(text: string | null | undefined): string {
	if (!text) return "";
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

export function renderStatusPageHtml(data: StatusPagePublicData, timestamp: number): string {
	const { page, services, affections } = data;
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

	const overallColors = hasIssues
		? { bg: "bg-yellow-50", border: "border-yellow-200", text: "text-yellow-700", dot: "bg-yellow-500" }
		: { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", dot: "bg-emerald-500" };
	const overallMessage = hasIssues ? "Some systems are experiencing issues" : "All systems operational";

	const BAR_COUNT = 90;

	const getBarColorForDay = (serviceId: string, dayDate: Date): string => {
		const dayStart = new Date(dayDate);
		const dayEnd = new Date(dayDate);
		dayEnd.setDate(dayEnd.getDate() + 1);

		for (const affection of affections) {
			const affectsService = affection.services.some((s) => s.id === serviceId);
			if (!affectsService) continue;

			const affectionStart = new Date(affection.createdAt);
			const affectionEnd = affection.resolvedAt ? new Date(affection.resolvedAt) : now;

			if (affectionStart < dayEnd && affectionEnd >= dayStart) {
				const impact = normalizeImpact(affection.services.find((s) => s.id === serviceId)?.impact);
				return statusColors[impact]?.bar || "bg-yellow-500";
			}
		}
		return "bg-emerald-500";
	};

	const generateUptimeBars = (serviceId: string, serviceCreatedAt: Date | null) => {
		const addedDate = serviceCreatedAt ? new Date(serviceCreatedAt) : now;
		const serviceAddedDay = new Date(addedDate.getFullYear(), addedDate.getMonth(), addedDate.getDate());
		const bars: string[] = [];

		for (let i = BAR_COUNT - 1; i >= 0; i--) {
			const dayDate = new Date(startOfToday);
			dayDate.setDate(dayDate.getDate() - i);

			if (dayDate < serviceAddedDay) {
				bars.push(`<div class="flex-1 h-4 rounded-sm bg-slate-200 min-w-[3px]"></div>`);
			} else {
				const color = getBarColorForDay(serviceId, dayDate);
				bars.push(`<div class="flex-1 h-4 rounded-sm ${color} min-w-[3px]"></div>`);
			}
		}

		return `<div class="flex gap-[2px] mt-2">${bars.join("")}</div>`;
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
	</style>
</head>
<body class="bg-gradient-to-b from-slate-50 to-white min-h-screen flex flex-col">
	<div class="flex-1 max-w-2xl mx-auto px-4 py-12 md:py-16 w-full">
		<header class="flex items-center justify-between mb-8">
			<div class="flex items-center gap-3">
				${
					logoUrl
						? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(page.name)}" class="w-12 h-12 object-contain">`
						: `<div class="w-12 h-12 rounded-xl bg-gradient-to-br from-slate-100 to-slate-50 border border-slate-200 flex items-center justify-center">
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

		<div class="rounded-lg ${overallColors.bg} border ${overallColors.border} p-4 mb-8">
			<div class="flex items-center justify-center gap-2">
				<div class="w-2.5 h-2.5 rounded-full ${overallColors.dot}"></div>
				<span class="${overallColors.text} font-medium">${overallMessage}</span>
			</div>
		</div>

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
				<span>&larr; Incident History</span>
				<a href="https://fire.app" class="flex items-center gap-1.5 hover:text-slate-500 transition-colors">
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

export function buildStatusPageResponse(data: StatusPagePublicData): Response {
	const html = renderStatusPageHtml(data, Date.now());
	return new Response(html, {
		status: 200,
		headers: {
			"Content-Type": "text/html; charset=utf-8",
			"Cache-Control": "public, max-age=30, stale-while-revalidate=60",
		},
	});
}
