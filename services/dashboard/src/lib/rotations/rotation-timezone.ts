type ZonedParts = {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();
const intlWithSupportedValues = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };

function getFormatter(timeZone: string) {
	const cached = formatterCache.get(timeZone);
	if (cached) {
		return cached;
	}

	const formatter = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
	});
	formatterCache.set(timeZone, formatter);
	return formatter;
}

function getZonedParts(date: Date, timeZone: string): ZonedParts {
	const parts = getFormatter(timeZone).formatToParts(date);
	const read = (type: Intl.DateTimeFormatPartTypes) => {
		const value = parts.find((part) => part.type === type)?.value;
		const parsed = Number.parseInt(value ?? "", 10);
		if (!Number.isFinite(parsed)) {
			throw new Error(`Missing ${type} for ${timeZone}`);
		}
		return parsed;
	};

	return {
		year: read("year"),
		month: read("month"),
		day: read("day"),
		hour: read("hour"),
		minute: read("minute"),
		second: read("second"),
	};
}

function toSyntheticUtcMs(parts: ZonedParts): number {
	return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, 0);
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
	return toSyntheticUtcMs(getZonedParts(date, timeZone)) - date.getTime();
}

function fromSyntheticUtcMs(ms: number): ZonedParts {
	const date = new Date(ms);
	return {
		year: date.getUTCFullYear(),
		month: date.getUTCMonth() + 1,
		day: date.getUTCDate(),
		hour: date.getUTCHours(),
		minute: date.getUTCMinutes(),
		second: date.getUTCSeconds(),
	};
}

function zonedLocalDateTimeToUtc(parts: ZonedParts, timeZone: string): Date {
	const localMs = toSyntheticUtcMs(parts);
	let result = new Date(localMs);

	for (let attempt = 0; attempt < 3; attempt += 1) {
		const offsetMs = getTimeZoneOffsetMs(result, timeZone);
		const next = new Date(localMs - offsetMs);
		if (next.getTime() === result.getTime()) {
			return result;
		}
		result = next;
	}

	return result;
}

function getLocalWeekday(parts: Pick<ZonedParts, "year" | "month" | "day">) {
	return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

function parseLocalDateTimeInput(value: string): ZonedParts | null {
	const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
	if (!match) return null;

	const [, yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw, secondRaw] = match;
	const parts = {
		year: Number.parseInt(yearRaw, 10),
		month: Number.parseInt(monthRaw, 10),
		day: Number.parseInt(dayRaw, 10),
		hour: Number.parseInt(hourRaw, 10),
		minute: Number.parseInt(minuteRaw, 10),
		second: Number.parseInt(secondRaw ?? "0", 10),
	};

	if (Object.values(parts).some((value) => !Number.isFinite(value))) {
		return null;
	}

	return parts;
}

export function resolveBrowserTimeZone() {
	return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function getSupportedRotationTimeZones() {
	const values = intlWithSupportedValues.supportedValuesOf?.("timeZone") ?? ["UTC"];
	const zones = values.length > 0 ? values : ["UTC"];
	return Array.from(new Set(["UTC", ...zones]));
}

export function formatRotationTimeZoneLabel(timeZone: string) {
	return timeZone.replaceAll("/", " / ").replaceAll("_", " ");
}

export function parseRotationIntervalToMs(interval: string) {
	const match = interval.match(/(\d+)\s*(day|week)s?/);
	if (!match) return null;
	const value = Number.parseInt(match[1], 10);
	const unit = match[2];
	if (unit === "day") return value * 24 * 60 * 60 * 1000;
	if (unit === "week") return value * 7 * 24 * 60 * 60 * 1000;
	return null;
}

export function getDefaultRotationAnchor(shiftLength: string, timeZone: string, now = new Date()) {
	const nowParts = getZonedParts(now, timeZone);

	if (shiftLength === "1 day") {
		return zonedLocalDateTimeToUtc({ ...nowParts, hour: 0, minute: 0, second: 0 }, timeZone);
	}

	if (shiftLength === "1 week" || shiftLength === "2 weeks") {
		const localMidnightMs = Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day);
		const startOfWeekMs = localMidnightMs - getLocalWeekday(nowParts) * 24 * 60 * 60 * 1000;
		const weekStart = fromSyntheticUtcMs(startOfWeekMs);
		return zonedLocalDateTimeToUtc({ ...weekStart, hour: 0, minute: 0, second: 0 }, timeZone);
	}

	throw new Error("Invalid shift length");
}

export function formatRotationDateTimeInput(date: Date, timeZone: string) {
	const parts = getZonedParts(date, timeZone);
	const year = String(parts.year).padStart(4, "0");
	const month = String(parts.month).padStart(2, "0");
	const day = String(parts.day).padStart(2, "0");
	const hours = String(parts.hour).padStart(2, "0");
	const minutes = String(parts.minute).padStart(2, "0");
	return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function parseRotationDateTimeInput(value: string, timeZone: string) {
	const parts = parseLocalDateTimeInput(value);
	if (!parts) return null;
	return zonedLocalDateTimeToUtc(parts, timeZone);
}

export function getRotationShiftIndexAt(anchor: Date, shiftMs: number, timeZone: string, at = new Date()) {
	if (!Number.isFinite(shiftMs) || shiftMs <= 0) return null;
	const anchorMs = toSyntheticUtcMs(getZonedParts(anchor, timeZone));
	const atMs = toSyntheticUtcMs(getZonedParts(at, timeZone));
	return Math.floor((atMs - anchorMs) / shiftMs);
}

export function getRotationShiftStartAtIndex(anchor: Date, shiftMs: number, timeZone: string, index: number) {
	if (!Number.isFinite(shiftMs) || shiftMs <= 0 || !Number.isFinite(index)) return null;
	const anchorMs = toSyntheticUtcMs(getZonedParts(anchor, timeZone));
	return zonedLocalDateTimeToUtc(fromSyntheticUtcMs(anchorMs + index * shiftMs), timeZone);
}

export function getNextRotationShiftStart(anchor: Date, shiftMs: number, timeZone: string, now = new Date()) {
	const index = getRotationShiftIndexAt(anchor, shiftMs, timeZone, now);
	if (index === null) return null;
	return getRotationShiftStartAtIndex(anchor, shiftMs, timeZone, index + 1);
}
