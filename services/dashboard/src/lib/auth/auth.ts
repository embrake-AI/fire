import { client } from "@fire/db/schema";
import { APIError, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { arrayContains } from "drizzle-orm";
import { uploadImageFromUrl } from "~/lib/blob";
import { db } from "~/lib/db";

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
	},
	user: {
		additionalFields: {
			clientId: {
				type: "string",
				required: false,
				input: false,
			},
			role: {
				type: "string",
				required: true,
				fieldName: "role",
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

					const userKey = user.id ?? user.email?.replace(/[^a-z0-9_-]/gi, "_") ?? "unknown";
					const uploadedImageUrl = user.image ? await uploadImageFromUrl(user.image, `users/${foundClient.id}/${userKey}`) : null;

					return {
						data: {
							...user,
							image: uploadedImageUrl ?? user.image,
							clientId: foundClient.id,
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
