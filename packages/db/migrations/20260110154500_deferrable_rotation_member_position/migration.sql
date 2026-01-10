ALTER TABLE "rotation_member" DROP CONSTRAINT IF EXISTS "rotation_member_rotation_position_idx";
DROP INDEX IF EXISTS "rotation_member_rotation_position_idx";
ALTER TABLE "rotation_member"
	ADD CONSTRAINT "rotation_member_rotation_position_idx"
	UNIQUE ("rotation_id", "position")
	DEFERRABLE INITIALLY IMMEDIATE;
