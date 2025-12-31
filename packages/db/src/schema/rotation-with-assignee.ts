import { sql } from "drizzle-orm";
import { interval, json, pgView, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { userIntegration } from "./integration";
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

// Not ideal that we have to redefine this, but else it doesn't work well with relations
export const rotationWithAssignee = pgView("rotationWithAssignee", {
	id: uuid("id").notNull(),
	name: text("name").notNull(),
	teamId: uuid("team_id"),
	clientId: text("client_id").notNull(),
	shiftStart: timestamp("shift_start", { withTimezone: true }),
	shiftLength: interval("shift_length").notNull(),
	assignees: text("assignees").array().notNull(),
	effectiveAssignee: text("effective_assignee"),
	baseAssignee: text("base_assignee"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
	userIntegrations: json("user_integrations").$type<Array<{ platform: string; userId: string }>>(),
}).as(sql`
	select
		${rotation.id} as "id",
		${rotation.name} as "name",
		${rotation.clientId} as "client_id",
		${shiftStart} as "shift_start",
		${rotation.shiftLength} as "shift_length",
		${rotation.assignees} as "assignees",
		${effectiveAssignee} as "effective_assignee",
		${baseAssignee} as "base_assignee",
		${rotation.createdAt} as "created_at",
		${rotation.updatedAt} as "updated_at",
		${rotation.teamId} as "team_id",
		COALESCE(
			json_agg(
				json_build_object(
					'platform', ${userIntegration.platform},
					'userId', ${userIntegration.data} ->> 'userId'
				)
			) FILTER (WHERE ${userIntegration.platform} IS NOT NULL),
			'[]'::json
		) as "user_integrations"
	from ${rotation}
	left join ${userIntegration} on ${effectiveAssignee} = ${userIntegration.userId}
	group by
		${rotation.id},
		${rotation.name},
		${rotation.clientId},
		${rotation.shiftLength},
		${rotation.assignees},
		${rotation.anchorAt},
		${rotation.assigneeOverwrite},
		${rotation.overrideForShiftStart},
		${rotation.createdAt},
		${rotation.updatedAt},
		${rotation.teamId}
`);
