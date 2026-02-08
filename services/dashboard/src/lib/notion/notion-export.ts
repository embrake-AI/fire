import type { NotionIntegrationData } from "@fire/db/schema";
import { incidentAnalysis, integration } from "@fire/db/schema";
import { createServerFn } from "@tanstack/solid-start";
import { and, eq } from "drizzle-orm";
import { authMiddleware } from "../auth/auth-middleware";
import { db } from "../db";
import { createUserFacingError } from "../errors/user-facing-error";
import type { IncidentAction, IncidentAnalysis } from "../incidents/incidents";
import { createNotionPage, postMortemToNotionBlocks, searchNotionPages } from "./notion";

export const getNotionPages = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.inputValidator((data: { query?: string }) => data)
	.handler(async ({ context, data }) => {
		const [notionIntegration] = await db
			.select()
			.from(integration)
			.where(and(eq(integration.clientId, context.clientId), eq(integration.platform, "notion")))
			.limit(1);

		if (!notionIntegration?.data) {
			return [];
		}

		const integrationData = notionIntegration.data as NotionIntegrationData;
		if (!integrationData.accessToken) {
			return [];
		}

		return searchNotionPages(integrationData.accessToken, data.query);
	});

export const exportToNotion = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { incidentId: string; parentPageId: string }) => data)
	.handler(async ({ context, data }) => {
		const [notionIntegration] = await db
			.select()
			.from(integration)
			.where(and(eq(integration.clientId, context.clientId), eq(integration.platform, "notion")))
			.limit(1);

		if (!notionIntegration?.data) {
			throw createUserFacingError("Notion isn't connected to this workspace.");
		}

		const integrationData = notionIntegration.data as NotionIntegrationData;
		if (!integrationData.accessToken) {
			throw createUserFacingError("Notion isn't connected to this workspace.");
		}

		const analysis = await db.query.incidentAnalysis.findFirst({
			where: {
				id: data.incidentId,
				clientId: context.clientId,
			},
			with: {
				actions: {
					columns: { id: true, description: true },
					orderBy: (actions, { asc }) => [asc(actions.createdAt)],
				},
			},
		});

		if (!analysis) {
			throw createUserFacingError("This analysis is no longer available.");
		}

		const fullAnalysis: IncidentAnalysis = {
			...analysis,
			actions: analysis.actions as IncidentAction[],
		};
		const blocks = postMortemToNotionBlocks(fullAnalysis);

		const page = await createNotionPage(integrationData.accessToken, data.parentPageId, analysis.title, blocks);

		await db
			.update(incidentAnalysis)
			.set({ notionPageId: page.id })
			.where(and(eq(incidentAnalysis.id, data.incidentId), eq(incidentAnalysis.clientId, context.clientId)));

		return page;
	});
