import type { IntegrationData, IntercomIntegrationData } from "@fire/db/schema";
import { integration, isIntercomIntegrationData, statusPage } from "@fire/db/schema";
import { createServerFn } from "@tanstack/solid-start";
import { and, eq } from "drizzle-orm";
import { authMiddleware } from "~/lib/auth/auth-middleware";
import { db } from "~/lib/db";
import { createUserFacingError } from "~/lib/errors/user-facing-error";

export type IntercomWorkspaceConfig = {
	connected: boolean;
	workspaceId: string | null;
	workspaceName: string | null;
	statusPageId: string | null;
};

function getIntercomData(data: IntegrationData): IntercomIntegrationData {
	if (!isIntercomIntegrationData(data)) {
		throw new Error("Intercom integration has invalid data shape");
	}
	return data;
}

export const getIntercomWorkspaceConfig = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(async ({ context }) => {
		const [record] = await db
			.select({ data: integration.data })
			.from(integration)
			.where(and(eq(integration.clientId, context.clientId), eq(integration.platform, "intercom")))
			.limit(1);

		if (!record?.data) {
			return {
				connected: false,
				workspaceId: null,
				workspaceName: null,
				statusPageId: null,
			} satisfies IntercomWorkspaceConfig;
		}

		const data = getIntercomData(record.data as IntegrationData);
		return {
			connected: true,
			workspaceId: data.workspaceId,
			workspaceName: data.workspaceName,
			statusPageId: data.statusPageId,
		} satisfies IntercomWorkspaceConfig;
	});

export const setIntercomStatusPage = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { statusPageId: string }) => data)
	.handler(async ({ context, data }) => {
		const statusPageId = data.statusPageId?.trim();
		if (!statusPageId) {
			throw createUserFacingError("Select a status page for Intercom.");
		}

		const [intercomIntegration] = await db
			.select({ id: integration.id, data: integration.data })
			.from(integration)
			.where(and(eq(integration.clientId, context.clientId), eq(integration.platform, "intercom")))
			.limit(1);

		if (!intercomIntegration?.data) {
			throw createUserFacingError("Connect Intercom before selecting a status page.");
		}

		const [matchedStatusPage] = await db
			.select({ id: statusPage.id })
			.from(statusPage)
			.where(and(eq(statusPage.id, statusPageId), eq(statusPage.clientId, context.clientId)))
			.limit(1);

		if (!matchedStatusPage) {
			throw createUserFacingError("Selected status page was not found.");
		}

		const intercomData = getIntercomData(intercomIntegration.data as IntegrationData);

		await db
			.update(integration)
			.set({
				data: {
					...intercomData,
					statusPageId,
				},
				updatedAt: new Date(),
			})
			.where(eq(integration.id, intercomIntegration.id));

		return { success: true };
	});
