import type { SlackIntegrationData } from "@fire/db/schema";
import { client, integration, userRole, user as userTable } from "@fire/db/schema";
import { APIError, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { and, arrayContains, count, eq } from "drizzle-orm";
import { uploadImageFromUrl } from "~/lib/blob";
import { db } from "~/lib/db";
import { lookupSlackUserIdByEmail } from "../slack";

const AUTH_USER_ROLE_VALUES = [...userRole.enumValues];

export const auth = betterAuth({
	baseURL: process.env.VITE_APP_URL,
	secret: process.env.BETTER_AUTH_SECRET,
	database: drizzleAdapter(db, {
		provider: "pg",
	}),
	socialProviders: {
		google: {
			clientId: process.env.GOOGLE_CLIENT_ID!,
			clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
		},
		slack: {
			clientId: process.env.SLACK_CLIENT_ID!,
			clientSecret: process.env.SLACK_CLIENT_SECRET!,
		},
	},
	account: {
		accountLinking: {
			enabled: true,
			trustedProviders: ["google", "slack"],
		},
	},
	user: {
		additionalFields: {
			clientId: {
				type: "string",
				required: false,
				input: false,
			},
			role: {
				type: AUTH_USER_ROLE_VALUES,
				required: true,
				fieldName: "role",
			},
			slackId: {
				type: "string",
				required: false,
				input: false,
			},
		},
	},
	session: {
		additionalFields: {
			impersonatedBy: {
				type: "string",
				required: false,
				input: false,
			},
		},
	},
	databaseHooks: {
		account: {
			create: {
				before: async (account, ctx) => {
					if (!ctx) return;

					const userId = account.userId;

					if (account.providerId === "slack") {
						await ctx.context.internalAdapter.updateUser(userId, {
							slackId: account.accountId,
						});
						return;
					}

					const user = (await ctx.context.internalAdapter.findUserById(userId)) as unknown as { id: string; email?: string; clientId?: string };
					if (!user?.email) {
						throw new APIError("BAD_REQUEST", { message: "User has no email" });
					}
					if (!user?.clientId) {
						throw new APIError("BAD_REQUEST", { message: "User has no client" });
					}

					const userCount = await ctx.context.internalAdapter.countTotalUsers([
						{
							operator: "eq",
							value: user.clientId,
							field: "clientId",
						},
					]);
					const isFirstUser = userCount === 1;

					const [slackIntegration] = await db
						.select()
						.from(integration)
						.where(and(eq(integration.clientId, user.clientId), eq(integration.platform, "slack")))
						.limit(1);

					if (!slackIntegration) {
						if (isFirstUser) {
							return;
						}
						throw new APIError("BAD_REQUEST", {
							message: "Organization has no Slack integration. Please contact your administrator.",
						});
					}

					const slackData = slackIntegration.data as SlackIntegrationData;
					const slackId = await lookupSlackUserIdByEmail(slackData.botToken, user.email);
					if (!slackId) {
						throw new APIError("BAD_REQUEST", {
							message: "User not found in Slack workspace. Please ensure you're using the same email as your Slack account.",
						});
					}

					await ctx.context.internalAdapter.updateUser(userId, { slackId });
				},
			},
		},
		user: {
			create: {
				before: async (user) => {
					const email = (user.email ?? "").toLowerCase().trim();
					const domain = email.split("@")[1];

					if (!domain) {
						throw new APIError("BAD_REQUEST", { message: "Invalid email address." });
					}

					const personalDomains = [
						"gmail.com",
						"googlemail.com",
						"yahoo.com",
						"yahoo.co.uk",
						"hotmail.com",
						"hotmail.co.uk",
						"outlook.com",
						"live.com",
						"msn.com",
						"icloud.com",
						"me.com",
						"mac.com",
						"aol.com",
						"protonmail.com",
						"proton.me",
						"zoho.com",
						"yandex.com",
						"mail.com",
						"gmx.com",
						"gmx.net",
					];

					if (personalDomains.includes(domain)) {
						throw new APIError("BAD_REQUEST", {
							message: `Personal email domains are not allowed. Please use your company email instead of ${domain}.`,
						});
					}

					const [foundClient] = await db
						.select()
						.from(client)
						.where(arrayContains(client.domains, [domain]))
						.limit(1);

					if (!foundClient) {
						throw new APIError("UNPROCESSABLE_ENTITY", {
							message: "This email domain is not allowed.",
						});
					}

					const userCountResult = await db.select({ count: count() }).from(userTable).where(eq(userTable.clientId, foundClient.id));
					const isFirstUser = userCountResult[0].count === 0;
					const defaultUserRole = foundClient.defaultUserRole === "SUPER_ADMIN" ? "ADMIN" : foundClient.defaultUserRole;
					const initialRole = isFirstUser ? "ADMIN" : defaultUserRole;

					if (!isFirstUser && !foundClient.autoCreateUsersWithSso) {
						throw new APIError("BAD_REQUEST", {
							message: "This workspace requires an admin to add your account before you can sign in.",
						});
					}

					const userKey = user.id ?? user.email?.replace(/[^a-z0-9_-]/gi, "_") ?? "unknown";
					const uploadedImageUrl = user.image ? await uploadImageFromUrl(user.image, `users/${foundClient.id}/${userKey}`) : null;

					return {
						data: {
							...user,
							image: uploadedImageUrl ?? user.image,
							clientId: foundClient.id,
							role: initialRole,
						},
					};
				},
			},
		},
	},

	onAPIError: {
		errorURL: "/auth/error",
	},
});
