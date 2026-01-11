import { sleep } from "workflow";
import { resumeHook } from "workflow/api";
import {
	clearOverrideInDb,
	createOverrideInDb,
	getNextTransition,
	loadRotationState,
	markRotationDeleted,
	setOverrideInDb,
	updateAnchorInDb,
	updateOverrideInDb,
	updateShiftLengthInDb,
} from "./steps";

export type ScheduleAction =
	| { type: "updateAnchor"; anchorAt: Date }
	| { type: "updateShiftLength"; shiftLength: string }
	| { type: "createOverride"; assigneeId: string; startAt: Date; endAt: Date }
	| { type: "setOverride"; assigneeId: string }
	| { type: "updateOverride"; overrideId: string; assigneeId: string; startAt: Date; endAt: Date }
	| { type: "clearOverride"; overrideId: string }
	| { type: "delete" };

export type ActionResult =
	| { success: true; id?: string }
	| { success: false; error: string };

type ActionWorkflowInput = {
	rotationId: string;
	action: ScheduleAction;
};

/**
 * Short-lived workflow that executes schedule-affecting actions.
 * Only handles operations that can change the next transition time:
 * - anchor time changes
 * - shift length changes
 * - override changes
 *
 * Returns the result so the caller can await it.
 * Wakes the schedule workflow only if the next transition time changed.
 */
export async function rotationActionWorkflow(input: ActionWorkflowInput): Promise<ActionResult> {
	"use workflow";

	const { rotationId, action } = input;

	try {
		const stateBefore = await loadRotationState(rotationId);
		const transitionBefore = stateBefore ? getNextTransition(stateBefore) : null;

		let resultId: string | undefined;

		switch (action.type) {
			case "updateAnchor":
				await updateAnchorInDb(rotationId, action.anchorAt);
				break;
			case "updateShiftLength":
				await updateShiftLengthInDb(rotationId, action.shiftLength);
				break;
			case "createOverride":
				resultId = await createOverrideInDb(rotationId, action.assigneeId, action.startAt, action.endAt);
				break;
			case "setOverride":
				await setOverrideInDb(rotationId, action.assigneeId);
				break;
			case "updateOverride":
				await updateOverrideInDb(action.overrideId, action.assigneeId, action.startAt, action.endAt);
				break;
			case "clearOverride":
				await clearOverrideInDb(action.overrideId);
				break;
			case "delete":
				await markRotationDeleted(rotationId);
				await wakeScheduleWorkflow(rotationId, null, true);
				return { success: true };
		}

		// Get new next transition time after the action
		const stateAfter = await loadRotationState(rotationId);
		const transitionAfter = stateAfter ? getNextTransition(stateAfter) : null;

		// Only wake schedule workflow if the next transition time changed
		const timeBefore = transitionBefore?.time.getTime() ?? null;
		const timeAfter = transitionAfter?.time.getTime() ?? null;

		if (timeBefore !== timeAfter) {
			await wakeScheduleWorkflow(rotationId, timeAfter, false);
		}

		return { success: true, id: resultId };
	} catch (error) {
		return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
	}
}

async function wakeScheduleWorkflow(rotationId: string, newWakeTime: number | null, deleted: boolean): Promise<void> {
	"use step";
	// 3 retries with 1 minute spacing for external operations
	let lastError: Error | undefined;
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			await resumeHook(`${rotationId}:wake`, { wakeAt: newWakeTime, deleted });
			return;
		} catch (error) {
			lastError = error instanceof Error ? error : new Error("Unknown error");
			if (attempt < 2) {
				await sleep(60_000); // 1 minute between retries
			}
		}
	}
	throw lastError;
}
