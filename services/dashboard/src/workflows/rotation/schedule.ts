import { createHook, sleep } from "workflow";
import {
	createRotationInDb,
	getEffectiveAssignee,
	getNextTransition,
	loadRotationState,
	notifyOnSlack,
} from "./steps";

export type CreateRotationInput = {
	rotationId: string;
	clientId: string;
	name: string;
	anchorAt: Date;
	shiftLength: string;
	teamId?: string;
};

type WakeSignal = { wakeAt: number | null; deleted?: boolean };

/**
 * Long-running workflow that manages the rotation schedule.
 * Wakes up at each transition point to send notifications.
 * Can be woken early by the action workflow when the schedule changes.
 */
export async function rotationScheduleWorkflow(input: CreateRotationInput) {
	"use workflow";

	const { rotationId, clientId, name, anchorAt, shiftLength, teamId } = input;

	// Create rotation in DB (1 retry for DB operations)
	await createRotationInDb(rotationId, clientId, name, anchorAt, shiftLength, teamId);

	// Create wake hook for action workflow to signal schedule changes
	const wakeHook = createHook<WakeSignal>({ token: `${rotationId}:wake` });

	let currentAssignee: string | null = null;
	let nextWakeTime: number | null = null;

	while (true) {
		// Load current state from DB
		const state = await loadRotationState(rotationId);
		if (!state) break; // Rotation deleted

		// Check for assignee change
		const newAssignee = getEffectiveAssignee(state, new Date());
		if (currentAssignee !== null && currentAssignee !== newAssignee) {
			await notifyWithRetry(rotationId, currentAssignee, newAssignee, "manual_change");
		}
		currentAssignee = newAssignee;

		// Calculate next transition on first iteration or after timer fires
		if (nextWakeTime === null) {
			const nextTransition = getNextTransition(state);
			nextWakeTime = nextTransition?.time.getTime() ?? null;
		}

		const sleepMs: number = nextWakeTime !== null ? Math.max(0, nextWakeTime - Date.now()) : Number.MAX_SAFE_INTEGER;

		// Race: timer vs wake signal from action workflow
		const result: { type: "timer" } | { type: "wake"; signal: WakeSignal } = await Promise.race([
			sleepMs < Number.MAX_SAFE_INTEGER ? sleep(sleepMs).then(() => ({ type: "timer" as const })) : new Promise<never>(() => {}),
			wakeHook.then((signal) => ({ type: "wake" as const, signal })),
		]);

		if (result.type === "timer") {
			// Timer won - transition occurred
			const newState = await loadRotationState(rotationId);
			if (newState) {
				const transitionedAssignee = getEffectiveAssignee(newState, new Date());
				if (currentAssignee !== transitionedAssignee) {
					const transition = getNextTransition(state); // Get reason from before-state
					await notifyWithRetry(rotationId, currentAssignee, transitionedAssignee, transition?.reason ?? "shift_change");
					currentAssignee = transitionedAssignee;
				}
			}
			// Recalculate next wake time after timer fires
			nextWakeTime = null;
			continue;
		}

		// Wake signal received
		if (result.signal.deleted) {
			break; // Rotation deleted, terminate workflow
		}
		nextWakeTime = result.signal.wakeAt;
	}
}

async function notifyWithRetry(
	rotationId: string,
	previousAssignee: string | null,
	newAssignee: string | null,
	reason: Parameters<typeof notifyOnSlack>[3],
): Promise<void> {
	"use step";
	// 3 retries with 1 minute spacing for external operations
	let lastError: Error | undefined;
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			await notifyOnSlack(rotationId, previousAssignee, newAssignee, reason);
			return;
		} catch (error) {
			lastError = error instanceof Error ? error : new Error("Unknown error");
			if (attempt < 2) {
				await sleep(60_000);
			}
		}
	}
	throw lastError;
}
