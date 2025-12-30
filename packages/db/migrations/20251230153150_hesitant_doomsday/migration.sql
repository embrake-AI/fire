ALTER TABLE "entry_point" ALTER COLUMN "type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "assignee_type";--> statement-breakpoint
CREATE TYPE "assignee_type" AS ENUM('user', 'rotation');--> statement-breakpoint
ALTER TABLE "entry_point" ALTER COLUMN "type" SET DATA TYPE "assignee_type" USING "type"::"assignee_type";