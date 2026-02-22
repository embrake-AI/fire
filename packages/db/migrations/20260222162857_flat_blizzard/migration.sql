CREATE TYPE "team_member_role" AS ENUM('MEMBER', 'ADMIN');--> statement-breakpoint
ALTER TABLE "team_member" ADD COLUMN "role" "team_member_role" DEFAULT 'ADMIN'::"team_member_role" NOT NULL;