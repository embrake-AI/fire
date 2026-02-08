import type { SlackIntegrationData } from "@fire/db/schema";
import { integration, rotation, rotationMember, rotationOverride, user } from "@fire/db/schema";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { createHook, sleep } from "workflow";
import { db } from "~/lib/db";
import { postSlackMessage } from "~/lib/slack";

const ROTATION_SCHEDULE_POLL_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type RotationScheduleWakeAction =
	| "update_anchor"
	| "update_shift_length"
	| "create_override"
	| "set_override"
	| "update_override"
	| "clear_override"
	| "add_assignee"
	| "reorder_assignee"
	| "remove_assignee";

export type RotationScheduleWakeSignal = {
	deleted?: boolean;
	action?: RotationScheduleWakeAction;
};

type RotationState = {
	rotationId: string;
	clientId: string;
	rotationName: string;
	slackChannelId: string | null;
	anchorAt: Date;
	shiftLengthMs: number;
	members: Array<{ assigneeId: string; position: number }>;
	overrides: Array<{ id: string; assigneeId: string; startAt: Date; endAt: Date; createdAt: Date }>;
};

type TransitionReason = "shift_change" | "override_start" | "override_end";
type NotificationReason = TransitionReason | "schedule_update";

type NextTransition = {
	at: Date;
	reason: TransitionReason;
};

type TimerResult = {
	type: "timer";
	transitionReason: TransitionReason | null;
};

type WakeResult = {
	type: "wake";
	signal: RotationScheduleWakeSignal;
};

export function getRotationScheduleWakeToken(rotationId: string) {
	return `rotation:${rotationId}:wake`;
}

export async function rotationScheduleWorkflow(input: { rotationId: string }) {
	"use workflow";

	const wakeToken = getRotationScheduleWakeToken(input.rotationId);
	const wakeHook = createHook<RotationScheduleWakeSignal>({ token: wakeToken });
	let pendingWake = wakeHook.then(
		(signal) =>
			({
				type: "wake",
				signal,
			}) satisfies WakeResult,
	);
	let lastEffectiveAssignee: string | null | undefined;
	let pendingReason: NotificationReason = "schedule_update";

	while (true) {
		const now = new Date();
		const state = await loadRotationState(input.rotationId, now);

		if (!state) {
			break;
		}

		const effectiveAssignee = getEffectiveAssignee(state, now);
		if (lastEffectiveAssignee !== undefined && lastEffectiveAssignee !== effectiveAssignee) {
			await logRotationChange({
				workflowRotationId: input.rotationId,
				rotationId: state.rotationId,
				clientId: state.clientId,
				rotationName: state.rotationName,
				slackChannelId: state.slackChannelId,
				reason: pendingReason,
				previousAssigneeId: lastEffectiveAssignee,
				nextAssigneeId: effectiveAssignee,
			});
		}

		lastEffectiveAssignee = effectiveAssignee;
		pendingReason = "schedule_update";

		const nextTransition = getNextTransition(state, now);
		const nextWakeAt = nextTransition?.at ?? new Date(now.getTime() + ROTATION_SCHEDULE_POLL_INTERVAL_MS);
		const sleepMs = Math.max(1_000, nextWakeAt.getTime() - Date.now());

		const result: TimerResult | WakeResult = await Promise.race([
			sleep(sleepMs).then(
				() =>
					({
						type: "timer",
						transitionReason: nextTransition?.reason ?? null,
					}) satisfies TimerResult,
			),
			pendingWake,
		]);

		if (result.type === "wake") {
			pendingWake = wakeHook.then(
				(signal) =>
					({
						type: "wake",
						signal,
					}) satisfies WakeResult,
			);
			if (result.signal.deleted) {
				break;
			}
			pendingReason = toWakeReason(result.signal.action);
			continue;
		}

		pendingReason = result.transitionReason ?? "schedule_update";
	}
}

async function loadRotationState(rotationId: string, now: Date): Promise<RotationState | null> {
	"use step";

	const [rotationRow] = await db
		.select({
			id: rotation.id,
			clientId: rotation.clientId,
			name: rotation.name,
			slackChannelId: rotation.slackChannelId,
			anchorAt: rotation.anchorAt,
			shiftLength: rotation.shiftLength,
		})
		.from(rotation)
		.where(eq(rotation.id, rotationId))
		.limit(1);

	if (!rotationRow) {
		return null;
	}

	const members = await db
		.select({
			assigneeId: rotationMember.assigneeId,
			position: rotationMember.position,
		})
		.from(rotationMember)
		.where(eq(rotationMember.rotationId, rotationId))
		.orderBy(rotationMember.position);

	const overrides = await db
		.select({
			id: rotationOverride.id,
			assigneeId: rotationOverride.assigneeId,
			startAt: rotationOverride.startAt,
			endAt: rotationOverride.endAt,
			createdAt: rotationOverride.createdAt,
		})
		.from(rotationOverride)
		.where(and(eq(rotationOverride.rotationId, rotationId), gt(rotationOverride.endAt, now)))
		.orderBy(desc(rotationOverride.createdAt), desc(rotationOverride.id));

	return {
		rotationId: rotationRow.id,
		clientId: rotationRow.clientId,
		rotationName: rotationRow.name,
		slackChannelId: rotationRow.slackChannelId,
		anchorAt: rotationRow.anchorAt,
		shiftLengthMs: parseIntervalToMs(rotationRow.shiftLength),
		members,
		overrides,
	};
}

function getEffectiveAssignee(state: RotationState, at: Date): string | null {
	if (state.members.length === 0) {
		return null;
	}

	const shiftIndex = Math.floor((at.getTime() - state.anchorAt.getTime()) / state.shiftLengthMs);
	const basePosition = mod(shiftIndex, state.members.length);
	const baseAssignee = state.members.find((member) => member.position === basePosition)?.assigneeId ?? null;

	const activeOverride = state.overrides.find((override) => override.startAt <= at && override.endAt > at);
	return activeOverride?.assigneeId ?? baseAssignee;
}

function getNextTransition(state: RotationState, now: Date): NextTransition | null {
	const transitions: NextTransition[] = [];

	if (state.members.length > 0) {
		const elapsedShifts = Math.floor((now.getTime() - state.anchorAt.getTime()) / state.shiftLengthMs);
		let nextShiftStart = state.anchorAt.getTime() + (elapsedShifts + 1) * state.shiftLengthMs;
		while (nextShiftStart <= now.getTime()) {
			nextShiftStart += state.shiftLengthMs;
		}
		transitions.push({ at: new Date(nextShiftStart), reason: "shift_change" });
	}

	for (const override of state.overrides) {
		if (override.startAt > now) {
			transitions.push({ at: override.startAt, reason: "override_start" });
		}
		if (override.endAt > now) {
			transitions.push({ at: override.endAt, reason: "override_end" });
		}
	}

	if (transitions.length === 0) {
		return null;
	}

	const priority: Record<TransitionReason, number> = {
		override_end: 0,
		override_start: 1,
		shift_change: 2,
	};

	transitions.sort((a, b) => {
		const timeDiff = a.at.getTime() - b.at.getTime();
		if (timeDiff !== 0) {
			return timeDiff;
		}
		return priority[a.reason] - priority[b.reason];
	});

	return transitions[0] ?? null;
}

function toWakeReason(action?: RotationScheduleWakeAction): NotificationReason {
	switch (action) {
		case "create_override":
		case "set_override":
			return "override_start";
		case "clear_override":
			return "override_end";
		default:
			return "schedule_update";
	}
}

async function logRotationChange(params: {
	workflowRotationId: string;
	rotationId: string;
	clientId: string;
	rotationName: string;
	slackChannelId: string | null;
	reason: NotificationReason;
	previousAssigneeId: string | null;
	nextAssigneeId: string | null;
}): Promise<void> {
	"use step";

	console.log(
		[
			"[rotation-notification]",
			`rotationId=${params.rotationId}`,
			`clientId=${params.clientId}`,
			`rotationName=${params.rotationName}`,
			`slackChannelId=${params.slackChannelId ?? "none"}`,
			`reason=${params.reason}`,
			`previousAssigneeId=${params.previousAssigneeId ?? "none"}`,
			`nextAssigneeId=${params.nextAssigneeId ?? "none"}`,
		].join(" "),
	);

	if (!params.slackChannelId) {
		return;
	}

	try {
		const [slackIntegration] = await db
			.select({ data: integration.data })
			.from(integration)
			.where(and(eq(integration.clientId, params.clientId), eq(integration.platform, "slack")))
			.limit(1);

		if (!slackIntegration?.data) {
			return;
		}

		const slackData = slackIntegration.data as SlackIntegrationData;
		if (!slackData.botToken) {
			return;
		}

		const assigneeIds = [params.nextAssigneeId].filter((id): id is string => !!id);
		const assigneesByUserId = new Map<string, { slackId: string | null; name: string }>();
		if (assigneeIds.length > 0) {
			const users = await db
				.select({
					id: user.id,
					name: user.name,
					slackId: user.slackId,
				})
				.from(user)
				.where(inArray(user.id, assigneeIds));

			for (const assignee of users) {
				assigneesByUserId.set(assignee.id, { slackId: assignee.slackId, name: assignee.name });
			}
		}

		const rotationUrl = getRotationUrl(params.workflowRotationId);
		const message = [
			`*${params.rotationName}* rotation changed (${formatReasonLabel(params.reason)}).`,
			`Next: ${formatAssigneeReference(params.nextAssigneeId, assigneesByUserId.get(params.nextAssigneeId ?? ""))}`,
			rotationUrl ? `View rotation: ${rotationUrl}` : `View rotation: /rotations/${params.workflowRotationId}`,
		].join("\n");

		await postSlackMessage(slackData.botToken, {
			channel: params.slackChannelId,
			text: message,
		});
	} catch (error) {
		console.error("Failed to send rotation notification to Slack", {
			rotationId: params.rotationId,
			clientId: params.clientId,
			channelId: params.slackChannelId,
			error,
		});
	}
}

function formatAssigneeReference(assigneeId: string | null, assignee?: { slackId: string | null; name: string }): string {
	if (!assigneeId) {
		return "_Unassigned_";
	}
	if (assignee?.slackId) {
		return `<@${assignee.slackId}>`;
	}
	if (assignee?.name) {
		return assignee.name;
	}
	return `user:${assigneeId}`;
}

function formatReasonLabel(reason: NotificationReason): string {
	switch (reason) {
		case "shift_change":
			return "shift change";
		case "override_start":
			return "override start";
		case "override_end":
			return "override end";
		default:
			return "schedule update";
	}
}

function getRotationUrl(rotationId: string): string | null {
	const appUrl = process.env.VITE_APP_URL;
	if (!appUrl) {
		return null;
	}

	try {
		return new URL(`/rotations/${rotationId}`, appUrl).toString();
	} catch {
		return null;
	}
}

function parseIntervalToMs(interval: unknown): number {
	if (typeof interval === "string") {
		return parseIntervalStringToMs(interval);
	}

	if (interval && typeof interval === "object") {
		return parseIntervalObjectToMs(interval as Record<string, unknown>);
	}

	throw new Error(`Unsupported interval format: ${String(interval)}`);
}

function parseIntervalStringToMs(raw: string): number {
	const text = raw.trim().toLowerCase();
	if (!text) {
		throw new Error("Shift length interval is empty");
	}

	const parts = text.match(/-?\d+(?:\.\d+)?\s+[a-zA-Z]+/g);
	if (!parts) {
		throw new Error(`Invalid shift length interval: ${raw}`);
	}

	let totalMs = 0;
	for (const part of parts) {
		const [valueRaw, unitRaw] = part.trim().split(/\s+/, 2);
		const value = Number(valueRaw);
		if (!Number.isFinite(value)) {
			throw new Error(`Invalid shift length value: ${part}`);
		}
		totalMs += value * unitToMs(unitRaw);
	}

	if (totalMs <= 0) {
		throw new Error(`Shift length must be positive: ${raw}`);
	}

	return totalMs;
}

function parseIntervalObjectToMs(interval: Record<string, unknown>): number {
	const units: Array<[key: string, unit: string]> = [
		["weeks", "week"],
		["days", "day"],
		["hours", "hour"],
		["minutes", "minute"],
		["seconds", "second"],
		["milliseconds", "millisecond"],
	];

	let totalMs = 0;
	for (const [key, unit] of units) {
		const value = asFiniteNumber(interval[key]);
		if (value !== null) {
			totalMs += value * unitToMs(unit);
		}
	}

	if (totalMs <= 0) {
		throw new Error(`Shift length interval object has no positive units: ${JSON.stringify(interval)}`);
	}

	return totalMs;
}

function asFiniteNumber(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}

	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}

	return null;
}

function unitToMs(unit: string): number {
	switch (unit.replace(/s$/, "")) {
		case "week":
			return 7 * 24 * 60 * 60 * 1000;
		case "day":
			return 24 * 60 * 60 * 1000;
		case "hour":
			return 60 * 60 * 1000;
		case "minute":
			return 60 * 1000;
		case "second":
			return 1000;
		case "millisecond":
			return 1;
		default:
			throw new Error(`Unsupported shift length unit: ${unit}`);
	}
}

function mod(value: number, base: number): number {
	return ((value % base) + base) % base;
}
