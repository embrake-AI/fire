import { sql } from "drizzle-orm";
import { pgView } from "drizzle-orm/pg-core";
import { rotation } from "./rotation";

export const shiftStart = sql`date_bin(${rotation.shiftLength}, now(), ${rotation.anchorAt})`;

export const baseAssignee = sql<string>`
  CASE
    WHEN cardinality(${rotation.assignees}) = 0 THEN NULL
    ELSE ${rotation.assignees}[(
      (
        (
          floor(
            extract(epoch from (${shiftStart} - ${rotation.anchorAt})) /
            extract(epoch from ${rotation.shiftLength})
          )::bigint % cardinality(${rotation.assignees})
        ) + cardinality(${rotation.assignees})
      ) % cardinality(${rotation.assignees})
    )::int + 1]
  END
`;

export const effectiveAssignee = sql<string>`
  CASE
    WHEN ${rotation.assigneeOverwrite} IS NOT NULL
     AND ${rotation.overrideForShiftStart} = ${shiftStart}
    THEN ${rotation.assigneeOverwrite}
    ELSE ${baseAssignee}
  END
`;

export const rotationWithAssignee = pgView("rotationWithAssignee").as((qb) =>
	qb
		.select({
			id: rotation.id,
			name: rotation.name,
			clientId: rotation.clientId,
			shiftStart: shiftStart.as("shift_start"),
			shiftLength: rotation.shiftLength,
			assignees: rotation.assignees,
			effectiveAssignee: effectiveAssignee.as("effective_assignee"),
			baseAssignee: baseAssignee.as("base_assignee"),
			createdAt: rotation.createdAt,
			updatedAt: rotation.updatedAt,
		})
		.from(rotation),
);
