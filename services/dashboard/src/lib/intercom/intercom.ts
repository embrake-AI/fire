import { createHmac, timingSafeEqual } from "node:crypto";
import type { IntegrationData, IntercomIntegrationData } from "@fire/db/schema";
import { incidentAffection, incidentAffectionService, incidentAffectionUpdate, integration, isIntercomIntegrationData, statusPage, statusPageService } from "@fire/db/schema";
import { createServerFn } from "@tanstack/solid-start";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { authMiddleware } from "~/lib/auth/auth-middleware";
import { db } from "~/lib/db";
import { createUserFacingError } from "~/lib/errors/user-facing-error";
import { normalizeDomain } from "~/lib/status-pages/status-pages.utils";
import { mustGetEnv } from "~/lib/utils/server";

export type IntercomWorkspaceConfig = {
	connected: boolean;
	workspaceId: string | null;
	workspaceName: string | null;
	statusPageId: string | null;
};

type IntercomCanvasRequest = {
	workspace_id?: string;
	intercom_data?: string;
	context?: {
		workspace_id?: string;
		location?: string;
	};
	location?: string;
};

type IntercomCanvasComponent =
	| {
			type: "text";
			id: string;
			text: string;
	  }
	| {
			type: "button";
			id: string;
			label: string;
			action: {
				type: "url";
				url: string;
			};
	  };

export type IntercomCanvasResponse = {
	canvas: {
		content: {
			components: IntercomCanvasComponent[];
		};
	};
};

function getIntercomData(data: IntegrationData): IntercomIntegrationData {
	if (!isIntercomIntegrationData(data)) {
		throw new Error("Intercom integration has invalid data shape");
	}
	return data;
}

function emptyCanvasResponse(): IntercomCanvasResponse {
	return {
		canvas: {
			content: {
				components: [],
			},
		},
	};
}

function extractWorkspaceId(payload: IntercomCanvasRequest): string | null {
	const workspaceId = payload.workspace_id ?? payload.context?.workspace_id;
	if (!workspaceId) {
		return null;
	}
	const trimmed = workspaceId.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function buildStatusPageUrl(page: { slug: string; customDomain: string | null }): string | null {
	const customDomain = normalizeDomain(page.customDomain);
	if (customDomain) {
		return `https://${customDomain}`;
	}

	const statusDomain = normalizeDomain(process.env.VITE_STATUS_PAGE_DOMAIN ?? null);
	if (statusDomain) {
		return `https://${statusDomain}/${page.slug}`;
	}

	const appUrl = process.env.VITE_APP_URL?.trim();
	if (appUrl) {
		const baseUrl = appUrl.endsWith("/") ? appUrl.slice(0, -1) : appUrl;
		return `${baseUrl}/status/${page.slug}`;
	}

	return null;
}

async function findIntercomInstallationByWorkspaceId(workspaceId: string): Promise<{ clientId: string; data: IntercomIntegrationData } | null> {
	const rows = await db
		.select({
			clientId: integration.clientId,
			data: integration.data,
		})
		.from(integration)
		.where(and(eq(integration.platform, "intercom"), sql`${integration.data} ->> 'workspaceId' = ${workspaceId}`))
		.limit(2);

	if (rows.length !== 1) {
		return null;
	}

	const row = rows[0];
	if (!row) {
		return null;
	}

	const data = row.data as IntegrationData;
	if (!isIntercomIntegrationData(data)) {
		return null;
	}

	return { clientId: row.clientId, data };
}

async function buildIssueCanvasResponse(workspaceId: string): Promise<IntercomCanvasResponse> {
	const installation = await findIntercomInstallationByWorkspaceId(workspaceId);
	if (!installation?.data.statusPageId) {
		return emptyCanvasResponse();
	}

	const [page] = await db
		.select({
			id: statusPage.id,
			slug: statusPage.slug,
			customDomain: statusPage.customDomain,
		})
		.from(statusPage)
		.where(and(eq(statusPage.id, installation.data.statusPageId), eq(statusPage.clientId, installation.clientId)))
		.limit(1);

	if (!page) {
		return emptyCanvasResponse();
	}

	const [latestAffection] = await db
		.select({
			title: incidentAffection.title,
			latestMessage: sql<string | null>`
				(
					select iau.message
					from ${incidentAffectionUpdate} iau
					where iau.affection_id = ${incidentAffection.id}
						and nullif(trim(iau.message), '') is not null
					order by iau.created_at desc
					limit 1
				)
			`,
		})
		.from(incidentAffection)
		.where(
			and(
				isNull(incidentAffection.resolvedAt),
				sql`exists (
					select 1
					from ${incidentAffectionService} ias
					join ${statusPageService} sps on sps.service_id = ias.service_id
					where ias.affection_id = ${incidentAffection.id}
						and sps.status_page_id = ${page.id}
				)`,
			),
		)
		.orderBy(desc(incidentAffection.updatedAt))
		.limit(1);

	if (!latestAffection) {
		return emptyCanvasResponse();
	}

	const statusPageUrl = buildStatusPageUrl(page);

	const components: IntercomCanvasComponent[] = [
		{
			type: "text",
			id: "status-summary",
			text: `Active incident: ${latestAffection.title}`,
		},
	];

	if (latestAffection.latestMessage?.trim()) {
		components.push({
			type: "text",
			id: "status-latest-message",
			text: latestAffection.latestMessage.trim(),
		});
	}

	if (statusPageUrl) {
		components.push({
			type: "button",
			id: "view-status-page",
			label: "View status page",
			action: {
				type: "url",
				url: statusPageUrl,
			},
		});
	}

	return {
		canvas: {
			content: {
				components,
			},
		},
	};
}

export function verifyIntercomSignature(rawBody: string, signatureHeader: string | null): boolean {
	if (!signatureHeader) {
		return false;
	}

	let clientSecret = "";
	try {
		clientSecret = mustGetEnv("INTERCOM_CLIENT_SECRET");
	} catch {
		return false;
	}

	const signature = signatureHeader.replace(/^sha256=/i, "").trim();
	const expectedSignature = createHmac("sha256", clientSecret).update(rawBody).digest("hex");

	try {
		const expectedBuffer = Buffer.from(expectedSignature, "utf8");
		const providedBuffer = Buffer.from(signature, "utf8");
		if (expectedBuffer.length !== providedBuffer.length) {
			return false;
		}
		return timingSafeEqual(expectedBuffer, providedBuffer);
	} catch {
		return false;
	}
}

export function parseIntercomCanvasRequest(rawBody: string): IntercomCanvasRequest | null {
	try {
		const payload = JSON.parse(rawBody) as IntercomCanvasRequest;
		if (typeof payload.intercom_data === "string" && payload.intercom_data.trim().length > 0) {
			return JSON.parse(payload.intercom_data) as IntercomCanvasRequest;
		}
		return payload;
	} catch {
		return null;
	}
}

export function isCustomerFacingLocation(payload: IntercomCanvasRequest): boolean {
	const location = payload.context?.location ?? payload.location;
	if (!location) {
		return true;
	}
	return location === "home" || location === "conversation" || location === "message";
}

export async function buildIntercomCanvasResponse(rawBody: string): Promise<IntercomCanvasResponse> {
	const payload = parseIntercomCanvasRequest(rawBody);
	if (!payload) {
		return emptyCanvasResponse();
	}

	if (!isCustomerFacingLocation(payload)) {
		return emptyCanvasResponse();
	}

	const workspaceId = extractWorkspaceId(payload);
	if (!workspaceId) {
		return emptyCanvasResponse();
	}

	return buildIssueCanvasResponse(workspaceId);
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
