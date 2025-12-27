ALTER TABLE "entry_point" ADD COLUMN "rotation_id" uuid;--> statement-breakpoint
ALTER TABLE "entry_point" ALTER COLUMN "type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "assignee_type";--> statement-breakpoint
CREATE TYPE "assignee_type" AS ENUM('slack-user', 'rotation');--> statement-breakpoint
ALTER TABLE "entry_point" ALTER COLUMN "type" SET DATA TYPE "assignee_type" USING "type"::"assignee_type";--> statement-breakpoint
ALTER TABLE "entry_point" ALTER COLUMN "assignee_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "rotation" ALTER COLUMN "updated_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "entry_point" ADD CONSTRAINT "entry_point_rotation_id_rotation_id_fkey" FOREIGN KEY ("rotation_id") REFERENCES "rotation"("id") ON DELETE CASCADE;