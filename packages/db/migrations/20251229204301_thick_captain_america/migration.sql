CREATE TYPE "user_role" AS ENUM('VIEWER', 'MEMBER', 'ADMIN', 'SUPER_ADMIN');--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "impersonated_by" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role" "user_role" DEFAULT 'VIEWER'::"user_role" NOT NULL;