import { createHmac, timingSafeEqual } from "node:crypto";
import type { IntegrationData, IntercomIntegrationData } from "@fire/db/schema";
import { incidentAffection, incidentAffectionService, integration, isIntercomIntegrationData, statusPage, statusPageService } from "@fire/db/schema";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { normalizeDomain } from "@/lib/status-pages.utils";

type IntercomCanvasRequest = {
	workspace_id?: string;
	intercom_data?: string;
	context?: {
		workspace_id?: string;
		location?: string;
	};
	location?: string;
};

type IntercomCanvasResponse = {
	canvas: {
		content: {
			components: Array<{
				type: "text";
				id: string;
				text: string;
			}>;
		};
	};
};

function emptyCanvasResponse(): IntercomCanvasResponse {
	return {
		canvas: {
			content: {
				components: [],
			},
		},
	};
}

function getIntercomData(data: IntegrationData): IntercomIntegrationData {
	if (!isIntercomIntegrationData(data)) {
		throw new Error("Intercom integration has invalid data shape");
	}
	return data;
}

function extractWorkspaceId(payload: IntercomCanvasRequest): string | null {
	const workspaceId = payload.workspace_id ?? payload.context?.workspace_id;
	if (!workspaceId) {
		return null;
	}
	const trimmed = workspaceId.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function parseIntercomCanvasRequest(rawBody: string): IntercomCanvasRequest | null {
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

function isCustomerFacingLocation(payload: IntercomCanvasRequest): boolean {
	const location = payload.context?.location ?? payload.location;
	if (!location) {
		return true;
	}
	return location === "home" || location === "conversation" || location === "message";
}

function buildStatusPageBaseUrl(page: { slug: string; customDomain: string | null }, fallbackOrigin: string | null): string | null {
	const customDomain = normalizeDomain(page.customDomain);
	if (customDomain) {
		return `https://${customDomain}`;
	}

	const statusDomain = normalizeDomain(process.env.VITE_STATUS_PAGE_DOMAIN ?? null);
	if (statusDomain) {
		return `https://${statusDomain}/${page.slug}`;
	}

	if (!fallbackOrigin) {
		return null;
	}

	try {
		return new URL(`/${page.slug}`, fallbackOrigin).toString().replace(/\/$/, "");
	} catch {
		return null;
	}
}

function buildIncidentUrl(page: { slug: string; customDomain: string | null }, incidentId: string, fallbackOrigin: string | null): string | null {
	const statusPageBaseUrl = buildStatusPageBaseUrl(page, fallbackOrigin);
	if (!statusPageBaseUrl) {
		return null;
	}

	const normalizedBase = statusPageBaseUrl.endsWith("/") ? statusPageBaseUrl.slice(0, -1) : statusPageBaseUrl;
	return `${normalizedBase}/history/${incidentId}`;
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

	const data = getIntercomData(row.data as IntegrationData);
	return { clientId: row.clientId, data };
}

async function buildIssueCanvasResponse(workspaceId: string, fallbackOrigin: string | null): Promise<IntercomCanvasResponse> {
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
			id: incidentAffection.id,
			title: incidentAffection.title,
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

	const incidentUrl = buildIncidentUrl(page, latestAffection.id, fallbackOrigin);
	if (!incidentUrl) {
		return emptyCanvasResponse();
	}

	return {
		canvas: {
			content: {
				components: [
					{
						type: "text",
						id: "incident-title",
						text: latestAffection.title,
					},
					{
						type: "text",
						id: "incident-url",
						text: incidentUrl,
					},
				],
			},
		},
	};
}

export function verifyIntercomSignature(rawBody: string, signatureHeader: string | null): boolean {
	if (!signatureHeader) {
		return false;
	}

	const clientSecret = process.env.INTERCOM_CLIENT_SECRET?.trim();
	if (!clientSecret) {
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

export async function buildIntercomCanvasResponse(rawBody: string, fallbackOrigin: string | null): Promise<IntercomCanvasResponse> {
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

	return buildIssueCanvasResponse(workspaceId, fallbackOrigin);
}
