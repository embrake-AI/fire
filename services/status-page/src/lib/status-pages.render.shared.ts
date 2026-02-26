export const POWERED_BY_URL = process.env.VITE_APP_URL ?? "";

export function escapeHtml(text: string | null | undefined): string {
	if (!text) return "";
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function formatDateFallback(date: Date): string {
	return new Date(date).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

function formatDateTimeFallback(date: Date): string {
	return new Date(date).toLocaleString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
}

function formatTooltipDateFallback(date: Date): string {
	return new Date(date).toLocaleDateString("en-US", {
		weekday: "short",
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

function formatRelativeTimeFallback(date: Date, now: Date): string {
	const diffMs = now.getTime() - new Date(date).getTime();
	const diffMins = Math.floor(diffMs / 60000);
	const diffHours = Math.floor(diffMs / 3600000);
	const diffDays = Math.floor(diffMs / 86400000);

	if (diffMins < 1) return "just now";
	if (diffMins < 60) return `${diffMins}m ago`;
	if (diffHours < 24) return `${diffHours}h ago`;
	if (diffDays === 1) return "yesterday";
	return `${diffDays}d ago`;
}

export function renderLocalizedTime(date: Date, format: "date" | "datetime" | "date-weekday"): string {
	const timestamp = new Date(date);
	const datetime = timestamp.toISOString();

	if (format === "date") {
		return `<time datetime="${datetime}" data-locale-format="date">${escapeHtml(formatDateFallback(timestamp))}</time>`;
	}
	if (format === "datetime") {
		return `<time datetime="${datetime}" data-locale-format="datetime">${escapeHtml(formatDateTimeFallback(timestamp))}</time>`;
	}
	return `<time datetime="${datetime}" data-locale-format="date-weekday">${escapeHtml(formatTooltipDateFallback(timestamp))}</time>`;
}

export function renderLocalizedRelativeTime(date: Date, now: Date): string {
	const timestamp = new Date(date);
	const datetime = timestamp.toISOString();
	return `<time datetime="${datetime}" data-locale-format="relative">${escapeHtml(formatRelativeTimeFallback(timestamp, now))}</time>`;
}

export function renderLocaleDateScript(): string {
	return `<script>
		(function () {
			if (typeof Intl === "undefined" || typeof document === "undefined") return;
			const locale = (navigator.languages && navigator.languages[0]) || navigator.language || "en-US";
			const dateFormatter = new Intl.DateTimeFormat(locale, {
				month: "short",
				day: "numeric",
				year: "numeric",
			});
			const dateTimeFormatter = new Intl.DateTimeFormat(locale, {
				month: "short",
				day: "numeric",
				year: "numeric",
				hour: "numeric",
				minute: "2-digit",
			});
			const dateWeekdayFormatter = new Intl.DateTimeFormat(locale, {
				weekday: "short",
				month: "short",
				day: "numeric",
				year: "numeric",
			});
			const relativeFormatter = typeof Intl.RelativeTimeFormat === "function" ? new Intl.RelativeTimeFormat(locale, { numeric: "auto" }) : null;
			const nowMs = Date.now();
			const units = [
				["year", 31_536_000_000],
				["month", 2_592_000_000],
				["day", 86_400_000],
				["hour", 3_600_000],
				["minute", 60_000],
			];

			const formatRelative = (date) => {
				if (!relativeFormatter) return null;
				const diffMs = date.getTime() - nowMs;
				const absDiffMs = Math.abs(diffMs);
				if (absDiffMs < 60_000) {
					return relativeFormatter.format(0, "second");
				}
				for (const unitEntry of units) {
					const unitName = unitEntry[0];
					const unitMs = unitEntry[1];
					if (absDiffMs >= unitMs || unitName === "minute") {
						const value = Math.round(diffMs / unitMs);
						return relativeFormatter.format(value, unitName);
					}
				}
				return null;
			};

			const nodes = document.querySelectorAll("[data-locale-format]");
			nodes.forEach((node) => {
				const format = node.getAttribute("data-locale-format");
				const datetime = node.getAttribute("datetime");
				if (!format || !datetime) return;
				const date = new Date(datetime);
				if (Number.isNaN(date.getTime())) return;
				if (format === "date") {
					node.textContent = dateFormatter.format(date);
					return;
				}
				if (format === "datetime") {
					node.textContent = dateTimeFormatter.format(date);
					return;
				}
				if (format === "date-weekday") {
					node.textContent = dateWeekdayFormatter.format(date);
					return;
				}
				if (format === "relative") {
					const relative = formatRelative(date);
					if (relative) node.textContent = relative;
				}
			});
		})();
	</script>`;
}

export function renderHtmlAutoRefreshScript(intervalMs: number): string {
	return `<script>
		(function () {
			const intervalMs = ${intervalMs};
			if (!Number.isFinite(intervalMs) || intervalMs <= 0) return;
			window.setInterval(() => {
				if (document.visibilityState !== "visible") return;
				window.location.reload();
			}, intervalMs);
		})();
	</script>`;
}

export function renderBaseHtml(options: { title: string; faviconUrl?: string | null; head?: string; content: string }): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${escapeHtml(options.title)}</title>
	${options.faviconUrl ? `<link rel="icon" href="${escapeHtml(options.faviconUrl)}">` : ""}
	${options.head ?? ""}
	<script src="https://cdn.tailwindcss.com"></script>
	<style>
		body {
			font-family: ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
		}
	</style>
</head>
<body class="bg-linear-to-b from-slate-50 to-white min-h-screen flex flex-col">
	${options.content}
	${renderLocaleDateScript()}
</body>
</html>`;
}

export function formatDate(date: Date): string {
	return renderLocalizedTime(date, "date");
}

export function formatDateTime(date: Date): string {
	return renderLocalizedTime(date, "datetime");
}

export function renderSubscribePopover(options: { feedPaths: { rss: string; atom: string }; supportUrl?: string | null }): string {
	const supportUrl = options.supportUrl?.trim();
	const showSupport = !!supportUrl;
	const supportHtml = supportUrl
		? `Visit our <a href="${escapeHtml(supportUrl)}" target="_blank" rel="noopener" class="text-slate-700 underline underline-offset-4 hover:text-slate-900">support site</a>.`
		: "";

	return `
	<div data-subscribe-popover class="absolute right-0 top-full mt-2 z-50 hidden w-72 sm:w-80 max-w-[calc(100vw-2rem)] bg-white rounded-xl border border-slate-200 shadow-lg">
		<div class="p-3">
			<div role="tablist" class="flex border-b border-slate-100 text-sm">
				<button type="button" class="subscribe-tab px-3 py-1.5 font-medium border-b-2" data-subscribe-tab="rss" data-active="true" aria-selected="true">RSS</button>
				<button type="button" class="subscribe-tab px-3 py-1.5 font-medium border-b-2" data-subscribe-tab="slack" data-active="false" aria-selected="false">Slack</button>
				${showSupport ? '<button type="button" class="subscribe-tab px-3 py-1.5 font-medium border-b-2" data-subscribe-tab="support" data-active="false" aria-selected="false">Support</button>' : ""}
			</div>
			<div class="pt-3">
				<div class="subscribe-panel space-y-3" data-subscribe-panel="rss" data-active="true">
					<p class="text-xs text-slate-600">Use any feed reader.</p>
					<div class="space-y-3">
						<div>
							<div class="text-[10px] font-medium text-slate-500 uppercase tracking-wide">RSS</div>
							<div class="mt-1.5 flex items-center gap-1.5">
								<input data-feed-path="${options.feedPaths.rss}" readonly class="flex-1 min-w-0 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700" aria-label="RSS feed url">
								<button type="button" data-copy-input class="px-2 py-1 text-xs font-medium text-slate-600 border border-slate-200 rounded-md hover:bg-slate-50 shrink-0">Copy</button>
							</div>
						</div>
						<div>
							<div class="text-[10px] font-medium text-slate-500 uppercase tracking-wide">Atom</div>
							<div class="mt-1.5 flex items-center gap-1.5">
								<input data-feed-path="${options.feedPaths.atom}" readonly class="flex-1 min-w-0 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700" aria-label="Atom feed url">
								<button type="button" data-copy-input class="px-2 py-1 text-xs font-medium text-slate-600 border border-slate-200 rounded-md hover:bg-slate-50 shrink-0">Copy</button>
							</div>
						</div>
					</div>
				</div>
				<div class="subscribe-panel space-y-2 hidden" data-subscribe-panel="slack" data-active="false">
					<p class="text-xs text-slate-600">In Slack, run the command below to follow updates in a channel.</p>
					<div class="flex items-center gap-1.5">
						<input data-feed-command="${options.feedPaths.rss}" readonly class="flex-1 min-w-0 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700" aria-label="Slack feed command">
						<button type="button" data-copy-input class="px-2 py-1 text-xs font-medium text-slate-600 border border-slate-200 rounded-md hover:bg-slate-50 shrink-0">Copy</button>
					</div>
					<p class="text-[10px] text-slate-400">Requires Slack's /feed app to be installed.</p>
				</div>
				${
					showSupport
						? `<div class="subscribe-panel space-y-2 hidden" data-subscribe-panel="support" data-active="false">
					<p class="text-xs text-slate-600">${supportHtml}</p>
				</div>`
						: ""
				}
			</div>
		</div>
	</div>
	<script>
		(function () {
			const popovers = document.querySelectorAll("[data-subscribe-popover]");
			popovers.forEach((popover) => {
				const container = popover.parentElement;
				if (!container) return;
				const toggleBtn = container.querySelector("[data-subscribe-toggle]");
				if (!toggleBtn) return;

				const showPopover = () => popover.classList.remove("hidden");
				const hidePopover = () => popover.classList.add("hidden");
				const togglePopover = () => popover.classList.toggle("hidden");

				toggleBtn.addEventListener("click", (e) => {
					e.stopPropagation();
					togglePopover();
				});

				document.addEventListener("click", (e) => {
					if (!popover.contains(e.target) && !toggleBtn.contains(e.target)) {
						hidePopover();
					}
				});

				document.addEventListener("keydown", (e) => {
					if (e.key === "Escape") hidePopover();
				});

				const feedInputs = popover.querySelectorAll("[data-feed-path]");
				feedInputs.forEach((input) => {
					const path = input.getAttribute("data-feed-path");
					if (!path) return;
					input.value = new URL(path, window.location.origin).toString();
				});

				const commandInputs = popover.querySelectorAll("[data-feed-command]");
				commandInputs.forEach((input) => {
					const path = input.getAttribute("data-feed-command");
					if (!path) return;
					const url = new URL(path, window.location.origin).toString();
					input.value = "/feed " + url;
				});

				const copyButtons = popover.querySelectorAll("[data-copy-input]");
				copyButtons.forEach((button) => {
					button.addEventListener("click", () => {
						const input = button.parentElement?.querySelector("input");
						if (!input) return;
						const value = input.value;
						if (!value) return;
						if (navigator.clipboard && window.isSecureContext) {
							navigator.clipboard.writeText(value);
						} else {
							input.focus();
							input.select();
							document.execCommand("copy");
						}
						const original = button.textContent || "Copy";
						button.textContent = "Copied";
						window.setTimeout(() => {
							button.textContent = original;
						}, 1500);
					});
				});

				const tabs = popover.querySelectorAll("[data-subscribe-tab]");
				const panels = popover.querySelectorAll("[data-subscribe-panel]");
				const setActive = (name) => {
					tabs.forEach((tab) => {
						const active = tab.getAttribute("data-subscribe-tab") === name;
						tab.setAttribute("data-active", active ? "true" : "false");
						tab.setAttribute("aria-selected", active ? "true" : "false");
					});
					panels.forEach((panel) => {
						const active = panel.getAttribute("data-subscribe-panel") === name;
						panel.setAttribute("data-active", active ? "true" : "false");
						panel.classList.toggle("hidden", !active);
					});
				};
				tabs.forEach((tab) => {
					tab.addEventListener("click", () => {
						const name = tab.getAttribute("data-subscribe-tab");
						if (name) setActive(name);
					});
				});
			});
		})();
	</script>`;
}
