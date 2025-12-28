DROP VIEW "rotationWithAssignee";--> statement-breakpoint
ALTER TABLE "incident_analysis" ADD COLUMN "entry_point_id" uuid;--> statement-breakpoint
ALTER TABLE "incident_analysis" ADD COLUMN "rotation_id" uuid;--> statement-breakpoint
ALTER TABLE "incident_analysis" ADD CONSTRAINT "incident_analysis_entry_point_id_entry_point_id_fkey" FOREIGN KEY ("entry_point_id") REFERENCES "entry_point"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "incident_analysis" ADD CONSTRAINT "incident_analysis_rotation_id_rotation_id_fkey" FOREIGN KEY ("rotation_id") REFERENCES "rotation"("id") ON DELETE SET NULL;--> statement-breakpoint
CREATE VIEW "rotationWithAssignee" AS (select "id", "name", "client_id", date_bin("shift_length", now(), "anchor_at") as "shift_start", "shift_length", "assignees", 
  CASE
    WHEN "assignee_overwrite" IS NOT NULL
     AND "override_for_shift_start" = date_bin("rotation"."shift_length", now(), "rotation"."anchor_at")
    THEN "assignee_overwrite"
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
    WHEN cardinality("assignees") = 0 THEN NULL
    ELSE "assignees"[(
      (
        (
          floor(
            extract(epoch from (date_bin("rotation"."shift_length", now(), "rotation"."anchor_at") - "anchor_at")) /
            extract(epoch from "shift_length")
          )::bigint % cardinality("assignees")
        ) + cardinality("assignees")
      ) % cardinality("assignees")
    )::int + 1]
  END
 as "base_assignee", "created_at", "updated_at" from "rotation");