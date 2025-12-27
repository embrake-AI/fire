/**
 * Raw SQL helpers for rotation operations.
 *
 * All helpers use epoch-based shift index calculation:
 * - shift_start = date_bin(shift_length, at_ts, anchor_at)
 * - k = floor((shift_start - anchor_at) / shift_length)
 * - i = ((k % n) + n) % n  -- 0-based index (handles negatives)
 * - base_assignee = assignees[i + 1]  -- Postgres arrays are 1-based
 *
 * Note: shift_length should only use hours/days/weeks (fixed seconds).
 * Avoid months/years as epoch math becomes approximate (30 days, etc.).
 */

import { type SQL, sql } from "drizzle-orm";
import type { rotation } from "./schema";

type RotationRow = typeof rotation.$inferSelect;

/**
 * Get the current assignee for a rotation at a given timestamp.
 *
 * Parameters:
 * - $1: rotation_id (uuid)
 * - $2: at_ts (timestamptz) - the timestamp to evaluate
 *
 * Returns:
 * - rotation_id
 * - shift_start, shift_end
 * - base_assignee (from rotation order)
 * - effective_assignee (override if applicable)
 * - is_overridden (boolean)
 * - assignee_count
 */
export function getCurrentAssigneeSQL(rotationId: string): SQL<{
	rotation_id: string;
	shift_start: Date;
	shift_end: Date;
	base_assignee: string;
	effective_assignee: string;
	is_overridden: boolean;
	assignee_count: number;
}> {
	const atTs = new Date();
	return sql`
WITH r AS (
  SELECT id, anchor_at, shift_length, assignees, assignee_overwrite, override_for_shift_start
  FROM rotation
  WHERE id = ${rotationId}
),
b AS (
  SELECT
    r.*,
    cardinality(r.assignees) AS n,
    date_bin(r.shift_length, ${atTs}::timestamptz, r.anchor_at) AS shift_start
  FROM r
),
k AS (
  SELECT
    b.*,
    CASE
      WHEN b.n = 0 THEN NULL
      ELSE floor(
        extract(epoch from (b.shift_start - b.anchor_at)) /
        extract(epoch from b.shift_length)
      )::bigint
    END AS shift_index
  FROM b
),
p AS (
  SELECT
    k.*,
    CASE
      WHEN n = 0 THEN NULL
      ELSE ((((shift_index % n) + n) % n)::int + 1)
    END AS pos1
  FROM k
)
SELECT
  id AS rotation_id,
  shift_start,
  shift_start + shift_length AS shift_end,
  assignees[pos1] AS base_assignee,
  CASE
    WHEN assignee_overwrite IS NOT NULL
         AND override_for_shift_start = shift_start
    THEN assignee_overwrite
    ELSE assignees[pos1]
  END AS effective_assignee,
  (assignee_overwrite IS NOT NULL AND override_for_shift_start = shift_start) AS is_overridden,
  n AS assignee_count
FROM p;
`;
}

/**
 * Update the anchor timestamp while keeping the current base assignee stable.
 *
 * Parameters:
 * - $1: rotation_id (uuid)
 * - $2: new_anchor_at (timestamptz)
 * - $3: at_ts (timestamptz) - reference time for current assignee calculation
 *
 * This rotates the assignees array left so that the same person remains
 * the current base assignee after the anchor change. If an override is active
 * for the current shift, it updates override_for_shift_start to the new shift_start.
 */
export function getUpdateAnchorSQL(rotationId: string, newAnchorAt: Date): SQL<RotationRow> {
	const atTs = new Date();
	return sql`
WITH locked AS (
  SELECT *
  FROM rotation
  WHERE id = ${rotationId}
  FOR UPDATE
),
calc AS (
  SELECT
    locked.*,
    cardinality(assignees) AS n,
    date_bin(shift_length, ${atTs}::timestamptz, anchor_at) AS old_shift_start,
    date_bin(shift_length, ${atTs}::timestamptz, ${newAnchorAt}::timestamptz) AS new_shift_start
  FROM locked
),
idx AS (
  SELECT
    *,
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
next AS (
  SELECT
    id,
    ${newAnchorAt}::timestamptz AS anchor_new,
    CASE
      WHEN n = 0 THEN assignees
      WHEN s = 0 THEN assignees
      ELSE (assignees[(s+1):n] || assignees[1:s])
    END AS assignees_new,
    CASE
      WHEN assignee_overwrite IS NOT NULL
           AND override_for_shift_start = old_shift_start
      THEN new_shift_start
      ELSE override_for_shift_start
    END AS override_for_shift_start_new
  FROM rot
)
UPDATE rotation r
SET anchor_at = next.anchor_new,
    assignees = next.assignees_new,
    override_for_shift_start = next.override_for_shift_start_new,
    updated_at = now()
FROM next
WHERE r.id = next.id
RETURNING r.*;
`;
}

/**
 * Update the shift interval while keeping the current base assignee stable.
 *
 * Parameters:
 * - $1: rotation_id (uuid)
 * - $2: new_shift_length (interval)
 * - $3: at_ts (timestamptz) - reference time for current assignee calculation
 *
 * This rotates the assignees array left so that the same person remains
 * the current base assignee after the interval change. If an override is active
 * for the current shift, it updates override_for_shift_start to the new shift_start.
 */
export function getUpdateIntervalSQL(rotationId: string, newShiftLength: string): SQL<RotationRow> {
	const atTs = new Date();
	return sql`
WITH locked AS (
  SELECT *
  FROM rotation
  WHERE id = ${rotationId}
  FOR UPDATE
),
calc AS (
  SELECT
    locked.*,
    cardinality(assignees) AS n,
    date_bin(shift_length, ${atTs}::timestamptz, anchor_at) AS old_shift_start,
    date_bin(${newShiftLength}::interval, ${atTs}::timestamptz, anchor_at) AS new_shift_start
  FROM locked
),
idx AS (
  SELECT
    *,
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
next AS (
  SELECT
    id,
    CASE
      WHEN n = 0 THEN assignees
      WHEN s = 0 THEN assignees
      ELSE (assignees[(s+1):n] || assignees[1:s])
    END AS assignees_new,
    CASE
      WHEN assignee_overwrite IS NOT NULL
           AND override_for_shift_start = old_shift_start
      THEN new_shift_start
      ELSE override_for_shift_start
    END AS override_for_shift_start_new,
    ${newShiftLength}::interval AS shift_length_new
  FROM rot
)
UPDATE rotation r
SET shift_length = next.shift_length_new,
    assignees = next.assignees_new,
    override_for_shift_start = next.override_for_shift_start_new,
    updated_at = now()
FROM next
WHERE r.id = next.id
RETURNING r.*;
`;
}

/**
 * Add an assignee to the rotation while keeping the current base assignee stable,
 * except when newPosition === 0, which makes the new assignee the BASE immediately.
 *
 * newPosition semantics (relative to normalized array):
 * - 0 => make new assignee BASE now (insert at front)
 * - 1 => insert AFTER current base
 * - 2 => insert 2 places after current base
 * - ...
 */
export function getAddAssigneeSQL(rotationId: string, assigneeId: string, newPosition?: number | null): SQL<RotationRow> {
	newPosition ??= null;
	const atTs = new Date();

	return sql`
WITH locked AS (
  SELECT *
  FROM rotation
  WHERE id = ${rotationId}
  FOR UPDATE
),
calc AS (
  SELECT
    locked.*,
    cardinality(assignees) AS n,
    date_bin(shift_length, ${atTs}::timestamptz, anchor_at) AS shift_start,
    CASE WHEN cardinality(assignees) = 0 THEN NULL ELSE floor(
      extract(epoch from (date_bin(shift_length, ${atTs}::timestamptz, anchor_at) - anchor_at)) /
      extract(epoch from shift_length)
    )::bigint END AS k
  FROM locked
),
pos AS (
  SELECT
    *,
    CASE
      WHEN n = 0 THEN 0
      ELSE (((k % n) + n) % n)::int
    END AS i
  FROM calc
),
-- Normalize so current base is first
norm AS (
  SELECT
    id,
    shift_start,
    n,
    CASE
      WHEN n = 0 OR i = 0 THEN assignees
      ELSE assignees[(i+1):n] || assignees[1:i]
    END AS a
  FROM pos
),
ins AS (
  SELECT
    id,
    shift_start,
    n,
    a,
    -- insertion position (1-based)
    CASE
      WHEN ${newPosition}::int IS NULL THEN n + 1
      WHEN ${newPosition}::int <= 0 THEN 1
      ELSE ${newPosition}::int + 1
    END AS raw_pos
  FROM norm
),
next AS (
  SELECT
    id,
    shift_start,
    CASE
      WHEN n = 0 THEN ARRAY[${assigneeId}::text]
      WHEN array_position(a, ${assigneeId}::text) IS NOT NULL THEN a
      ELSE (
        a[1:GREATEST(0, LEAST(raw_pos, n + 1) - 1)]
        || ARRAY[${assigneeId}::text]::text[]
        || a[LEAST(raw_pos, n + 1):n]
      )
    END AS assignees_new,
    raw_pos
  FROM ins
)
UPDATE rotation r
SET
  assignees = next.assignees_new,
  updated_at = now()
FROM next
WHERE r.id = next.id
RETURNING r.*;
`;
}

/**
 * Remove an assignee from the rotation.
 *
 * Parameters:
 * - $1: rotation_id (uuid)
 * - $2: assignee_id (text) - the assignee to remove
 * - $3: at_ts (timestamptz) - reference time for current assignee calculation
 *
 * The array is first "normalized" by rotating so the current base is at the front,
 * then the assignee is removed. If the removed assignee is the current base,
 * the next person becomes the new base. If the removed assignee is the active override,
 * the override is cleared.
 */
export function getRemoveAssigneeSQL(rotationId: string, assigneeId: string, clearOverride = true): SQL<RotationRow> {
	const atTs = new Date();
	return sql`
WITH locked AS (
  SELECT *
  FROM rotation
  WHERE id = ${rotationId}
  FOR UPDATE
),
calc AS (
  SELECT
    locked.*,
    cardinality(assignees) AS n,
    date_bin(shift_length, ${atTs}::timestamptz, anchor_at) AS shift_start,
    CASE WHEN cardinality(assignees) = 0 THEN NULL ELSE floor(
      extract(epoch from (date_bin(shift_length, ${atTs}::timestamptz, anchor_at) - anchor_at)) /
      extract(epoch from shift_length)
    )::bigint END AS k
  FROM locked
),
pos AS (
  SELECT
    *,
    CASE
      WHEN n = 0 THEN 0
      ELSE (((k % n) + n) % n)::int
    END AS i
  FROM calc
),
rotated AS (
  SELECT
    id,
    shift_start,
    assignee_overwrite,
    override_for_shift_start,
    CASE
      WHEN n = 0 THEN assignees
      WHEN i = 0 THEN assignees
      ELSE (assignees[(i+1):n] || assignees[1:i])
    END AS a
  FROM pos
),
next AS (
  SELECT
    id,
    shift_start,
    array_remove(a, ${assigneeId}::text) AS assignees_new,
    CASE
      WHEN assignee_overwrite = ${assigneeId}::text AND override_for_shift_start = shift_start AND ${clearOverride} = true
      THEN NULL
      ELSE assignee_overwrite
    END AS assignee_overwrite_new,
    CASE
      WHEN assignee_overwrite = ${assigneeId}::text AND override_for_shift_start = shift_start AND ${clearOverride} = true
      THEN NULL
      ELSE override_for_shift_start
    END AS override_for_shift_start_new
  FROM rotated
)
UPDATE rotation r
SET assignees = next.assignees_new,
    assignee_overwrite = next.assignee_overwrite_new,
    override_for_shift_start = next.override_for_shift_start_new,
    updated_at = now()
FROM next
WHERE r.id = next.id
RETURNING r.*;
`;
}

/**
 * Set the override for a rotation at a given timestamp.
 *
 * Parameters:
 * - $1: rotation_id (uuid)
 * - $2: assignee_id (text) - the assignee to override
 * - $3: at_ts (timestamptz) - reference time for current assignee calculation
 *
 * This sets the override for the current shift.
 */
export function getSetOverrideSQL(rotationId: string, assigneeId: string) {
	return sql<{
		id: string;
		override_assignee: string | null;
		override_for_shift_start: Date | null;
	}>`
WITH locked AS (
  SELECT
    id,
    date_bin(shift_length, now(), anchor_at) AS shift_start
  FROM rotation
  WHERE id = ${rotationId}
  FOR UPDATE
)
UPDATE rotation r
SET
  assignee_overwrite = ${assigneeId}::text,
  override_for_shift_start = locked.shift_start,
  updated_at = now()
FROM locked
WHERE r.id = locked.id
RETURNING
  r.id,
  r.assignee_overwrite,
  r.override_for_shift_start;
`;
}
