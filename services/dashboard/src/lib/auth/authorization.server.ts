import { team, teamMember } from "@fire/db/schema";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { createUserFacingError } from "../errors/user-facing-error";
import { hasPermission, type UserRole } from "./permissions";

const FORBIDDEN_MESSAGE = "You don't have permission to perform this action.";
const FORBIDDEN_CODE = "FORBIDDEN";

type TeamWriteContext = {
	role?: UserRole | null;
	clientId?: string | null;
	userId?: string | null;
};

function createForbiddenError() {
	return createUserFacingError(FORBIDDEN_MESSAGE, { code: FORBIDDEN_CODE });
}

export async function assertTeamAdminOrWorkspaceCatalogWriter(context: TeamWriteContext, teamId: string | null | undefined): Promise<void> {
	if (hasPermission(context.role, "catalog.write")) {
		return;
	}

	if (!hasPermission(context.role, "catalog.read")) {
		throw createForbiddenError();
	}

	if (!teamId || !context.clientId || !context.userId) {
		throw createForbiddenError();
	}

	const [membership] = await db
		.select({ role: teamMember.role })
		.from(teamMember)
		.innerJoin(team, eq(teamMember.teamId, team.id))
		.where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, context.userId), eq(team.clientId, context.clientId)))
		.limit(1);

	if (membership?.role !== "ADMIN") {
		throw createForbiddenError();
	}
}
