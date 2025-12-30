DROP VIEW "rotationWithAssignee";--> statement-breakpoint
CREATE VIEW "rotationWithAssignee" AS (select "rotation"."id", "rotation"."name", "rotation"."client_id", date_bin("rotation"."shift_length", now(), "rotation"."anchor_at") as "shift_start", "rotation"."shift_length", "rotation"."assignees", 
  CASE
    WHEN "rotation"."assignee_overwrite" IS NOT NULL
     AND "rotation"."override_for_shift_start" = date_bin("rotation"."shift_length", now(), "rotation"."anchor_at")
    THEN "rotation"."assignee_overwrite"
    ELSE 
  CASE
    WHEN cardinality("rotation"."assignees") = 0 THEN NULL
    ELSE "rotation"."assignees"[(
      (
        (
          floor(
            extract(epoch from (date_bin("rotation"."shift_length", now(), "rotation"."anchor_at") - "rotation"."anchor_at")) /
            extract(epoch from "rotation"."shift_length")
          )::bigint % cardinality("rotation"."assignees")
        ) + cardinality("rotation"."assignees")
      ) % cardinality("rotation"."assignees")
    )::int + 1]
  END

  END
 as "effective_assignee", 
  CASE
    WHEN cardinality("rotation"."assignees") = 0 THEN NULL
    ELSE "rotation"."assignees"[(
      (
        (
          floor(
            extract(epoch from (date_bin("rotation"."shift_length", now(), "rotation"."anchor_at") - "rotation"."anchor_at")) /
            extract(epoch from "rotation"."shift_length")
          )::bigint % cardinality("rotation"."assignees")
        ) + cardinality("rotation"."assignees")
      ) % cardinality("rotation"."assignees")
    )::int + 1]
  END
 as "base_assignee", "rotation"."created_at", "rotation"."updated_at", "rotation"."team_id", 
				COALESCE(
					json_agg(
						json_build_object(
							'platform', "user_integration"."platform",
							'userId', "user_integration"."data"->>'userId'
						)
					) FILTER (WHERE "user_integration"."platform" IS NOT NULL),
					'[]'::json
				)
			 as "user_integrations" from "rotation" left join "user_integration" on 
  CASE
    WHEN "rotation"."assignee_overwrite" IS NOT NULL
     AND "rotation"."override_for_shift_start" = date_bin("rotation"."shift_length", now(), "rotation"."anchor_at")
    THEN "rotation"."assignee_overwrite"
    ELSE 
  CASE
    WHEN cardinality("rotation"."assignees") = 0 THEN NULL
    ELSE "rotation"."assignees"[(
      (
        (
          floor(
            extract(epoch from (date_bin("rotation"."shift_length", now(), "rotation"."anchor_at") - "rotation"."anchor_at")) /
            extract(epoch from "rotation"."shift_length")
          )::bigint % cardinality("rotation"."assignees")
        ) + cardinality("rotation"."assignees")
      ) % cardinality("rotation"."assignees")
    )::int + 1]
  END

  END
 = "user_integration"."user_id" group by "rotation"."id", "rotation"."name", "rotation"."client_id", "rotation"."shift_length", "rotation"."assignees", "rotation"."anchor_at", "rotation"."assignee_overwrite", "rotation"."override_for_shift_start", "rotation"."created_at", "rotation"."updated_at", "rotation"."team_id");