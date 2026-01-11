export type RotationState = {
	rotationId: string;
	anchorAt: Date;
	shiftLengthMs: number;
	assignees: Array<{ id: string; position: number }>;
	overrides: Array<{ id: string; assigneeId: string; startAt: Date; endAt: Date; createdAt: Date }>;
	deleted?: boolean;
};

/**
 * Calculate the effective assignee at a given time.
 * Returns the override assignee if one is active, otherwise the base assignee.
 */
export function getEffectiveAssignee(state: RotationState, at: Date): string | null {
	if (state.assignees.length === 0) return null;

	// Calculate base assignee from rotation schedule
	const shiftIndex = Math.floor((at.getTime() - state.anchorAt.getTime()) / state.shiftLengthMs);
	const n = state.assignees.length;
	const basePosition = ((shiftIndex % n) + n) % n;
	const baseAssignee = state.assignees.find((a) => a.position === basePosition)?.id ?? null;

	// Check for active override (latest createdAt wins if multiple)
	const activeOverride = state.overrides
		.filter((o) => o.startAt <= at && o.endAt > at)
		.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

	return activeOverride?.assigneeId ?? baseAssignee;
}

export type TransitionReason = "shift_change" | "override_start" | "override_end";

export type NextTransition = {
	time: Date;
	reason: TransitionReason;
};

/**
 * Calculate the next assignee transition time.
 * Returns the earliest of: next shift boundary, next override start, or active override end.
 */
export function getNextTransition(state: RotationState): NextTransition | null {
	const now = new Date();
	const candidates: NextTransition[] = [];

	// Next shift boundary (only if there are assignees)
	if (state.assignees.length > 0) {
		const shiftIndex = Math.floor((now.getTime() - state.anchorAt.getTime()) / state.shiftLengthMs);
		const nextShiftStart = new Date(state.anchorAt.getTime() + (shiftIndex + 1) * state.shiftLengthMs);
		candidates.push({ time: nextShiftStart, reason: "shift_change" });
	}

	// Override boundaries
	for (const override of state.overrides) {
		// Future override starts
		if (override.startAt > now) {
			candidates.push({ time: override.startAt, reason: "override_start" });
		}
		// Active or future override ends
		if (override.endAt > now) {
			candidates.push({ time: override.endAt, reason: "override_end" });
		}
	}

	// Return earliest transition
	if (candidates.length === 0) return null;
	candidates.sort((a, b) => a.time.getTime() - b.time.getTime());
	return candidates[0];
}
