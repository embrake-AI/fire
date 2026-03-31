import { getCurrentAssigneeSQL } from "@fire/db/rotation-helpers";
import type { SlackIntegrationData } from "@fire/db/schema";
import { integration, user } from "@fire/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { createHook, sleep } from "workflow";
import { db } from "~/lib/db";
import { postSlackMessage } from "~/lib/slack";

const ROTATION_SCHEDULE_POLL_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type RotationScheduleWakeAction =
	| "update_anchor"
	| "update_shift_length"
	| "update_slack_channel"
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
	currentAssigneeId: string | null;
	shiftEnd: Date | null;
	assigneeCount: number;
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

		const effectiveAssignee = state.currentAssigneeId;
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

	const rotationRow = await db.query.rotation.findFirst({
		where: {
			id: rotationId,
		},
		columns: {
			id: true,
			clientId: true,
			name: true,
			slackChannelId: true,
		},
		with: {
			overrides: {
				where: {
					endAt: {
						gt: now,
					},
				},
				columns: {
					id: true,
					assigneeId: true,
					startAt: true,
					endAt: true,
					createdAt: true,
				},
				orderBy: {
					createdAt: "desc",
					id: "desc",
				},
			},
		},
	});

	if (!rotationRow) {
		return null;
	}

	const { rows } = await db.execute<{
		shift_end: Date;
		effective_assignee: string | null;
		assignee_count: number;
	}>(getCurrentAssigneeSQL(rotationId));
	const assigneeRow = rows[0];

	return {
		rotationId: rotationRow.id,
		clientId: rotationRow.clientId,
		rotationName: rotationRow.name,
		slackChannelId: rotationRow.slackChannelId,
		currentAssigneeId: assigneeRow?.effective_assignee ?? null,
		shiftEnd: assigneeRow?.shift_end ?? null,
		assigneeCount: assigneeRow?.assignee_count ?? 0,
		overrides: rotationRow.overrides,
	};
}

function getNextTransition(state: RotationState, now: Date): NextTransition | null {
	const transitions: NextTransition[] = [];

	if (state.assigneeCount > 0 && state.shiftEnd && state.shiftEnd > now) {
		transitions.push({ at: state.shiftEnd, reason: "shift_change" });
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

		const assigneeIds = [params.previousAssigneeId, params.nextAssigneeId].filter((id): id is string => !!id);
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
		const linkUrl = rotationUrl ?? `/rotations/${params.workflowRotationId}`;
		const nextRef = formatAssigneeReference(params.nextAssigneeId, assigneesByUserId.get(params.nextAssigneeId ?? ""));
		const prevRef = formatAssigneeReference(params.previousAssigneeId, assigneesByUserId.get(params.previousAssigneeId ?? ""));

		const { text, blocks } = buildRotationBlocks({
			rotationName: params.rotationName,
			reason: params.reason,
			nextRef,
			prevRef,
			linkUrl,
			isUnassigned: !params.nextAssigneeId,
		});

		await postSlackMessage(slackData.botToken, {
			channel: params.slackChannelId,
			text,
			blocks,
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

function buildRotationBlocks(params: { rotationName: string; reason: NotificationReason; nextRef: string; prevRef: string; linkUrl: string; isUnassigned: boolean }): {
	text: string;
	blocks: unknown[];
} {
	if (params.isUnassigned) {
		const text = `:warning: *${params.rotationName}* rotation — no one on-call`;
		return {
			text,
			blocks: [
				{ type: "section", text: { type: "mrkdwn", text } },
				{
					type: "section",
					text: {
						type: "mrkdwn",
						text: "This rotation currently has no assignee. Add members or create an override to restore coverage.",
					},
				},
				{
					type: "context",
					elements: [{ type: "mrkdwn", text: `<${params.linkUrl}|View rotation>` }],
				},
			],
		};
	}

	const { icon, subtitle, nextLabel, prevLabel } = reasonConfig(params.reason);
	const headline = `${icon} *${params.rotationName}* rotation — ${subtitle}`;

	return {
		text: headline,
		blocks: [
			{ type: "section", text: { type: "mrkdwn", text: headline } },
			{
				type: "section",
				fields: [
					{ type: "mrkdwn", text: `*${nextLabel}*\n${params.nextRef}` },
					{ type: "mrkdwn", text: `*${prevLabel}*\n${params.prevRef}` },
				],
			},
			{
				type: "context",
				elements: [{ type: "mrkdwn", text: `<${params.linkUrl}|View rotation>` }],
			},
		],
	};
}

function reasonConfig(reason: NotificationReason) {
	switch (reason) {
		case "shift_change":
			return { icon: ":arrows_counterclockwise:", subtitle: "shift handoff", nextLabel: "Now on-call", prevLabel: "Previous" };
		case "override_start":
			return { icon: ":arrow_right:", subtitle: "override active", nextLabel: "Now on-call", prevLabel: "Covering for" };
		case "override_end":
			return { icon: ":rewind:", subtitle: "override ended", nextLabel: "Back on-call", prevLabel: "Previous" };
		default:
			return { icon: ":wrench:", subtitle: "schedule updated", nextLabel: "Now on-call", prevLabel: "Previous" };
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
