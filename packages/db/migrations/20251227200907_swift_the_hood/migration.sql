CREATE VIEW "entryPointWithAssignee" AS (select "entry_point"."id", "entry_point"."type", 
        CASE
          WHEN "entry_point"."type" = 'rotation'::assignee_type THEN 
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

          ELSE "entry_point"."assignee_id"
        END
       as "assignee", "entry_point"."prompt", "entry_point"."is_fallback", "entry_point"."client_id" from "entry_point" left join "rotation" on ("entry_point"."rotation_id" = "rotation"."id" and "entry_point"."client_id" = "rotation"."client_id"));