import {
	getSetOverrideSQL,
	getUpdateAnchorSQL,
	getUpdateIntervalSQL,
} from "@fire/db/rotation-helpers";
import { rotation, rotationMember, rotationOverride } from "@fire/db/schema";
import { and, eq, gt } from "drizzle-orm";
import { db } from "../../../lib/db";
import type { RotationState } from "./calc";

export async function createRotationInDb(
	rotationId: string,
	clientId: string,
	name: string,
	anchorAt: Date,
	shiftLength: string,
	teamId?: string,
): Promise<void> {
	"use step";
	await db.insert(rotation).values({
		id: rotationId,
		clientId,
		name,
		shiftLength,
		anchorAt,
		teamId,
	});
}

export async function loadRotationState(rotationId: string): Promise<RotationState | null> {
	"use step";
	const [rot] = await db.select().from(rotation).where(eq(rotation.id, rotationId));

	if (!rot) return null;

	const members = await db
		.select({ id: rotationMember.assigneeId, position: rotationMember.position })
		.from(rotationMember)
		.where(eq(rotationMember.rotationId, rotationId))
		.orderBy(rotationMember.position);

	const now = new Date();
	const overrides = await db
		.select({
			id: rotationOverride.id,
			assigneeId: rotationOverride.assigneeId,
			startAt: rotationOverride.startAt,
			endAt: rotationOverride.endAt,
			createdAt: rotationOverride.createdAt,
		})
		.from(rotationOverride)
		.where(and(eq(rotationOverride.rotationId, rotationId), gt(rotationOverride.endAt, now)));

	const shiftLengthMs = intervalToMs(rot.shiftLength);

	return {
		rotationId,
		anchorAt: rot.anchorAt,
		shiftLengthMs,
		assignees: members,
		overrides,
	};
}

function intervalToMs(interval: string): number {
	const match = interval.match(/^(\d+)\s+(day|week)s?$/i);
	if (!match) {
		throw new Error(`Invalid interval format: ${interval}`);
	}
	const value = parseInt(match[1], 10);
	const unit = match[2].toLowerCase();

	const MS_PER_DAY = 24 * 60 * 60 * 1000;
	const MS_PER_WEEK = 7 * MS_PER_DAY;

	switch (unit) {
		case "day":
			return value * MS_PER_DAY;
		case "week":
			return value * MS_PER_WEEK;
		default:
			throw new Error(`Unknown interval unit: ${unit}`);
	}
}

export async function updateAnchorInDb(rotationId: string, anchorAt: Date): Promise<void> {
	"use step";
	await db.execute(getUpdateAnchorSQL(rotationId, anchorAt));
}

export async function updateShiftLengthInDb(rotationId: string, shiftLength: string): Promise<void> {
	"use step";
	await db.execute(getUpdateIntervalSQL(rotationId, shiftLength));
}

export async function createOverrideInDb(
	rotationId: string,
	assigneeId: string,
	startAt: Date,
	endAt: Date,
): Promise<string> {
	"use step";
	const [created] = await db
		.insert(rotationOverride)
		.values({
			rotationId,
			assigneeId,
			startAt,
			endAt,
		})
		.returning({ id: rotationOverride.id });

	return created.id;
}

export async function setOverrideInDb(rotationId: string, assigneeId: string): Promise<void> {
	"use step";
	await db.execute(getSetOverrideSQL(rotationId, assigneeId));
}

export async function updateOverrideInDb(
	overrideId: string,
	assigneeId: string,
	startAt: Date,
	endAt: Date,
): Promise<void> {
	"use step";
	await db.update(rotationOverride).set({ assigneeId, startAt, endAt }).where(eq(rotationOverride.id, overrideId));
}

export async function clearOverrideInDb(overrideId: string): Promise<void> {
	"use step";
	await db.delete(rotationOverride).where(eq(rotationOverride.id, overrideId));
}

export async function markRotationDeleted(rotationId: string): Promise<void> {
	"use step";
	await db.delete(rotation).where(eq(rotation.id, rotationId));
}
