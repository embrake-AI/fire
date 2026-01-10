import { type SQL, sql } from "drizzle-orm";
import { rotation, rotationMember, rotationOverride } from "./schema";

type RotationRow = typeof rotation.$inferSelect;

/**
 * Get the current assignee for a rotation at a given timestamp.
 */
export function getCurrentAssigneeSQL(rotationId: string): SQL<{
	rotation_id: string;
	shift_start: Date;
	shift_end: Date;
	base_assignee: string | null;
	effective_assignee: string | null;
	is_overridden: boolean;
	assignee_count: number;
}> {
	const atTs = new Date();
	const ctes: SQL[] = [];

	ctes.push(sql`
r AS (
  SELECT id, anchor_at, shift_length
  FROM ${rotation}
  WHERE id = ${rotationId}
)
`);

	ctes.push(sql`
member_count AS (
  SELECT count(*)::int AS n
  FROM ${rotationMember}
  WHERE rotation_id = ${rotationId}
)
`);

	ctes.push(sql`
calc AS (
  SELECT
    r.*,
    member_count.n,
    date_bin(r.shift_length, ${atTs}::timestamptz, r.anchor_at) AS shift_start
  FROM r, member_count
)
`);

	ctes.push(sql`
idx AS (
  SELECT
    calc.*,
    CASE
      WHEN n = 0 THEN NULL
      ELSE floor(
        extract(epoch from (shift_start - anchor_at)) /
        extract(epoch from shift_length)
      )::bigint
    END AS shift_index
  FROM calc
)
`);

	ctes.push(sql`
pos AS (
  SELECT
    idx.*,
    CASE
      WHEN n = 0 THEN NULL
      ELSE (((shift_index % n) + n) % n)::int
    END AS base_pos
  FROM idx
)
`);

	const shiftCte = sql.join(ctes, sql`,`);
	return sql`
WITH ${shiftCte}
,base AS (
  SELECT rm.assignee_id AS base_assignee
  FROM ${rotationMember} rm, pos
  WHERE rm.rotation_id = ${rotationId}
    AND rm.position = pos.base_pos
  LIMIT 1
),
override AS (
  SELECT ro.assignee_id AS override_assignee
  FROM ${rotationOverride} ro
  WHERE ro.rotation_id = ${rotationId}
    AND ro.start_at <= ${atTs}::timestamptz
    AND ro.end_at > ${atTs}::timestamptz
  ORDER BY ro.created_at DESC, ro.id DESC
  LIMIT 1
)
SELECT
  ${rotationId}::uuid AS rotation_id,
  pos.shift_start AS shift_start,
  pos.shift_start + pos.shift_length AS shift_end,
  base.base_assignee AS base_assignee,
  COALESCE(override.override_assignee, base.base_assignee) AS effective_assignee,
  (override.override_assignee IS NOT NULL) AS is_overridden,
  pos.n AS assignee_count
FROM pos
LEFT JOIN base ON true
LEFT JOIN override ON true;
`;
}

/**
 * Update the anchor timestamp while keeping the current base assignee stable.
 */
export function getUpdateAnchorSQL(rotationId: string, newAnchorAt: Date): SQL<RotationRow> {
	const atTs = new Date();
	return sql`
WITH locked AS (
  SELECT *
  FROM ${rotation}
  WHERE id = ${rotationId}
  FOR UPDATE
),
members AS (
  SELECT *
  FROM ${rotationMember}
  WHERE rotation_id = ${rotationId}
  FOR UPDATE
),
member_count AS (
  SELECT count(*)::int AS n
  FROM members
),
calc AS (
  SELECT
    locked.*,
    member_count.n,
    date_bin(locked.shift_length, ${atTs}::timestamptz, locked.anchor_at) AS old_shift_start,
    date_bin(locked.shift_length, ${atTs}::timestamptz, ${newAnchorAt}::timestamptz) AS new_shift_start
  FROM locked, member_count
),
idx AS (
  SELECT
    calc.*,
    CASE WHEN n = 0 THEN NULL ELSE floor(
      extract(epoch from (old_shift_start - anchor_at)) /
      extract(epoch from shift_length)
    )::bigint END AS k_old,
    CASE WHEN n = 0 THEN NULL ELSE floor(
      extract(epoch from (new_shift_start - ${newAnchorAt}::timestamptz)) /
      extract(epoch from shift_length)
    )::bigint END AS k_new
  FROM calc
),
pos AS (
  SELECT
    *,
    CASE WHEN n = 0 THEN NULL ELSE (((k_old % n) + n) % n)::int END AS i_old,
    CASE WHEN n = 0 THEN NULL ELSE (((k_new % n) + n) % n)::int END AS i_new
  FROM idx
),
rot AS (
  SELECT
    *,
    CASE WHEN n = 0 THEN 0 ELSE (((i_old - i_new) % n) + n) % n END AS s
  FROM pos
),
shifted AS (
  UPDATE ${rotationMember} rm
  SET position = CASE
    WHEN rot.n = 0 THEN rm.position
    ELSE (((rm.position - rot.s) % rot.n) + rot.n) % rot.n
  END
  FROM rot
  WHERE rm.rotation_id = rot.id
  RETURNING rm.*
),
updated AS (
  UPDATE ${rotation} r
  SET anchor_at = ${newAnchorAt}::timestamptz,
      updated_at = now()
  FROM rot
  WHERE r.id = rot.id
  RETURNING r.*
)
SELECT * FROM updated;
`;
}

export function getUpdateIntervalSQL(rotationId: string, newShiftLength: string): SQL<RotationRow> {
	const atTs = new Date();
	return sql`
WITH locked AS (
  SELECT *
  FROM ${rotation}
  WHERE id = ${rotationId}
  FOR UPDATE
),
members AS (
  SELECT *
  FROM ${rotationMember}
  WHERE rotation_id = ${rotationId}
  FOR UPDATE
),
member_count AS (
  SELECT count(*)::int AS n
  FROM members
),
calc AS (
  SELECT
    locked.*,
    member_count.n,
    date_bin(locked.shift_length, ${atTs}::timestamptz, locked.anchor_at) AS old_shift_start,
    date_bin(${newShiftLength}::interval, ${atTs}::timestamptz, locked.anchor_at) AS new_shift_start
  FROM locked, member_count
),
idx AS (
  SELECT
    calc.*,
    CASE WHEN n = 0 THEN NULL ELSE floor(
      extract(epoch from (old_shift_start - anchor_at)) /
      extract(epoch from shift_length)
    )::bigint END AS k_old,
    CASE WHEN n = 0 THEN NULL ELSE floor(
      extract(epoch from (new_shift_start - anchor_at)) /
      extract(epoch from ${newShiftLength}::interval)
    )::bigint END AS k_new
  FROM calc
),
pos AS (
  SELECT
    *,
    CASE WHEN n = 0 THEN NULL ELSE (((k_old % n) + n) % n)::int END AS i_old,
    CASE WHEN n = 0 THEN NULL ELSE (((k_new % n) + n) % n)::int END AS i_new
  FROM idx
),
rot AS (
  SELECT
    *,
    CASE WHEN n = 0 THEN 0 ELSE (((i_old - i_new) % n) + n) % n END AS s
  FROM pos
),
shifted AS (
  UPDATE ${rotationMember} rm
  SET position = CASE
    WHEN rot.n = 0 THEN rm.position
    ELSE (((rm.position - rot.s) % rot.n) + rot.n) % rot.n
  END
  FROM rot
  WHERE rm.rotation_id = rot.id
  RETURNING rm.*
),
updated AS (
  UPDATE ${rotation} r
  SET shift_length = ${newShiftLength}::interval,
      updated_at = now()
  FROM rot
  WHERE r.id = rot.id
  RETURNING r.*
)
SELECT * FROM updated;
`;
}

export function getAddAssigneeSQL(rotationId: string, assigneeId: string): SQL<void> {
	return sql`
WITH locked AS (
  SELECT 1
  FROM ${rotation}
  WHERE id = ${rotationId}
  FOR UPDATE
),
members AS (
  SELECT
    position
  FROM ${rotationMember}
  WHERE rotation_id = ${rotationId}
  FOR UPDATE
),
member_count AS (
  SELECT count(*)::int AS n
  FROM members
),
inserted AS (
  INSERT INTO ${rotationMember} (rotation_id, assignee_id, position)
  SELECT
    ${rotationId}::uuid,
    ${assigneeId}::text,
    member_count.n
  FROM member_count
  WHERE NOT EXISTS (
    SELECT 1
    FROM ${rotationMember} rm
    WHERE rm.rotation_id = ${rotationId}
      AND rm.assignee_id = ${assigneeId}::text
  )
)
UPDATE ${rotation}
SET updated_at = now()
WHERE id = ${rotationId};
`;
}

/**
 * Move an existing assignee to a new absolute position.
 *
 * newPosition semantics (0-based):
 * - 0 => first
 * - 1 => second
 * - ...
 *
 * NOTE: Must run inside a transaction that defers the
 * "rotation_member_rotation_position_idx" constraint.
 */
export function getMoveAssigneeSQL(rotationId: string, assigneeId: string, newPosition: number): SQL<void> {
	return sql`
WITH target AS (
  SELECT
    rm.position
  FROM ${rotationMember} rm
  WHERE rm.rotation_id = ${rotationId}
    AND rm.assignee_id = ${assigneeId}::text
  FOR UPDATE
  LIMIT 1
),
stats AS (
  SELECT count(*)::int AS n
  FROM ${rotationMember}
  WHERE rotation_id = ${rotationId}
),
target_pos AS (
  SELECT
    target.position AS curr_pos,
    CASE
      WHEN target.position IS NULL THEN NULL
      WHEN ${newPosition}::int < 0 THEN NULL
      WHEN ${newPosition}::int >= stats.n THEN NULL
      ELSE ${newPosition}::int
    END AS target_pos
  FROM stats
  LEFT JOIN target ON true
),
guard AS (
  SELECT
    CASE
      WHEN target_pos.curr_pos IS NULL THEN 'assignee_not_found'
      WHEN target_pos.target_pos IS NULL THEN 'position_out_of_bounds'
      ELSE '1'
    END::int AS ok
  FROM target_pos
),
updated AS (
  UPDATE ${rotationMember} rm
  SET position = CASE
    WHEN rm.assignee_id = ${assigneeId}::text THEN target_pos.target_pos
    WHEN target_pos.target_pos < target_pos.curr_pos
      AND rm.position >= target_pos.target_pos
      AND rm.position < target_pos.curr_pos
      THEN rm.position + 1
    WHEN target_pos.target_pos > target_pos.curr_pos
      AND rm.position > target_pos.curr_pos
      AND rm.position <= target_pos.target_pos
      THEN rm.position - 1
    ELSE rm.position
  END
  FROM target_pos, guard
  WHERE rm.rotation_id = ${rotationId}
    AND target_pos.curr_pos IS NOT NULL
    AND target_pos.target_pos IS NOT NULL
)
UPDATE ${rotation}
SET updated_at = now()
WHERE id = ${rotationId};
`;
}

/**
 * Remove an assignee from the rotation.
 *
 * NOTE: Must run inside a transaction that defers the
 * "rotation_member_rotation_position_idx" constraint.
 */
export function getRemoveAssigneeSQL(rotationId: string, assigneeId: string, shouldDeleteOverride = true): SQL<void> {
	const atTs = new Date();
	return sql`
WITH target AS (
  SELECT
    rm.id,
    rm.position
  FROM ${rotationMember} rm
  WHERE rm.rotation_id = ${rotationId}
    AND rm.assignee_id = ${assigneeId}::text
  LIMIT 1
),
deleted AS (
  DELETE FROM ${rotationMember}
  WHERE id IN (SELECT id FROM target)
  RETURNING position
),
shifted AS (
  UPDATE ${rotationMember} rm
  SET position = rm.position - 1
  WHERE rm.rotation_id = ${rotationId}
    AND rm.position > (SELECT position FROM deleted)
),
cleared_override AS (
  DELETE FROM ${rotationOverride}
  WHERE ${shouldDeleteOverride}::boolean
    AND rotation_id = ${rotationId}
    AND assignee_id = ${assigneeId}::text
    AND start_at <= ${atTs}::timestamptz
    AND end_at > ${atTs}::timestamptz
)
UPDATE ${rotation}
SET updated_at = now()
WHERE id = ${rotationId};
`;
}

/**
 * Set the override for a rotation's current shift.
 */
export function getSetOverrideSQL(rotationId: string, assigneeId: string) {
	return sql<void>`
WITH locked AS (
  SELECT
    id,
    anchor_at,
    shift_length,
    date_bin(shift_length, now(), anchor_at) AS shift_start
  FROM ${rotation}
  WHERE id = ${rotationId}
  FOR UPDATE
)
INSERT INTO ${rotationOverride} (rotation_id, assignee_id, start_at, end_at)
SELECT
  locked.id,
  ${assigneeId}::text,
  locked.shift_start,
  locked.shift_start + locked.shift_length
FROM locked;
`;
}
