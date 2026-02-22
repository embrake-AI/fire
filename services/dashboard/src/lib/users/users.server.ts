import type { userRole } from "@fire/db/schema";
import { client, user } from "@fire/db/schema";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { db } from "../db";

type UserRole = (typeof userRole.enumValues)[number];
type ProvisionedUserRole = Exclude<UserRole, "SUPER_ADMIN">;
type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

function getProvisionedRole(role: UserRole): ProvisionedUserRole {
	return role === "SUPER_ADMIN" ? "ADMIN" : role;
}

export async function createWorkspaceUser(
	executor: DbExecutor,
	data: {
		clientId: string;
		name: string;
		email: string;
		image?: string | null;
		slackId?: string | null;
		emailVerified?: boolean;
	},
) {
	const [workspaceClient] = await executor
		.select({
			defaultUserRole: client.defaultUserRole,
		})
		.from(client)
		.where(eq(client.id, data.clientId))
		.limit(1);

	if (!workspaceClient) {
		throw new Error("Workspace not found");
	}

	const [createdUser] = await executor
		.insert(user)
		.values({
			id: nanoid(),
			name: data.name,
			email: data.email,
			emailVerified: data.emailVerified ?? false,
			image: data.image ?? null,
			clientId: data.clientId,
			slackId: data.slackId ?? null,
			role: getProvisionedRole(workspaceClient.defaultUserRole),
		})
		.returning({
			id: user.id,
			name: user.name,
			email: user.email,
			image: user.image,
			slackId: user.slackId,
			role: user.role,
		});

	if (!createdUser) {
		throw new Error("Failed to create user");
	}

	return createdUser;
}
