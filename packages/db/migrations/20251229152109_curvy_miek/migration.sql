ALTER TABLE "entry_point" DROP CONSTRAINT "entry_point_team_id_team_id_fkey";--> statement-breakpoint
ALTER TABLE "entry_point" ALTER COLUMN "type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "assignee_type";--> statement-breakpoint
CREATE TYPE "assignee_type" AS ENUM('slack-user', 'rotation');--> statement-breakpoint
ALTER TABLE "entry_point" ALTER COLUMN "type" SET DATA TYPE "assignee_type" USING "type"::"assignee_type";--> statement-breakpoint
ALTER TABLE "entry_point" DROP COLUMN "team_id";