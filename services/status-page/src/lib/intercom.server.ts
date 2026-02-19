import { createHmac, timingSafeEqual } from "node:crypto";
import type { IntegrationData, IntercomIntegrationData } from "@fire/db/schema";
import { incidentAffection, incidentAffectionService, incidentAffectionUpdate, integration, isIntercomIntegrationData, statusPage, statusPageService } from "@fire/db/schema";
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

type IntercomCanvasInitializeResponse = {
	canvas: {
		content_url?: string;
	};
};

type IntercomCanvasContentResponse = {
	content: {
		components: IntercomCanvasComponent[];
	};
};

type IntercomCanvasComponent =
	| {
			type: "text";
			id: string;
			text: string;
			style?: "header" | "paragraph" | "muted" | "error";
			align?: "left" | "center" | "right";
			bottom_margin?: "none";
	  }
	| {
			type: "button";
			id: string;
			label: string;
			style?: "primary" | "secondary" | "link";
			action: {
				type: "url";
				url: string;
			};
	  }
	| {
			type: "list";
			items: Array<{
				type: "item";
				id: string;
				title: string;
				subtitle?: string;
				action?: {
					type: "url";
					url: string;
				};
			}>;
	  };

export type IntercomCanvasInitializeBuildResult = { status: 200; response: IntercomCanvasInitializeResponse } | { status: 404 };
export type IntercomCanvasContentBuildResult = { status: 200; response: IntercomCanvasContentResponse } | { status: 404 };

function getIntercomData(data: IntegrationData): IntercomIntegrationData {
	if (!isIntercomIntegrationData(data)) {
		throw new Error("Intercom integration has invalid data shape");
	}
	return data;
}

function normalizeStatusPageId(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
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

function buildStatusPageBaseUrl(page: { slug: string; customDomain: string | null }): string | null {
	const customDomain = normalizeDomain(page.customDomain);
	if (customDomain) {
		return `https://${customDomain}`;
	}

	const statusDomain = normalizeDomain(process.env.VITE_STATUS_PAGE_DOMAIN ?? null);
	if (statusDomain) {
		return `https://${statusDomain}/${page.slug}`;
	}

	return null;
}

function buildIncidentUrl(statusPageBaseUrl: string, incidentId: string): string {
	const normalizedBase = statusPageBaseUrl.endsWith("/") ? statusPageBaseUrl.slice(0, -1) : statusPageBaseUrl;
	return `${normalizedBase}/history/${incidentId}`;
}

function buildAllSystemsOperationalResponse(statusPageUrl: string): IntercomCanvasContentResponse {
	return {
		content: {
			components: [
				{
					type: "text",
					id: "status-page-link",
					text: `[All systems operational](${statusPageUrl})`,
					style: "header",
					align: "center",
				},
			],
		},
	};
}

function buildActiveAffectionResponse(affectionTitle: string, subtitle: string, incidentUrl: string): IntercomCanvasContentResponse {
	return {
		content: {
			components: [
				{
					type: "text",
					id: "incident-title",
					text: affectionTitle,
					style: "header",
					align: "center",
				},
				{
					type: "text",
					id: "incident-subtitle",
					text: subtitle,
					style: "muted",
					align: "center",
				},
				{
					type: "button",
					id: "incident-link",
					label: "View incident updates",
					style: "primary",
					action: {
						type: "url",
						url: incidentUrl,
					},
				},
			],
		},
	};
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

async function buildIssueCanvasResponse(statusPageId: string): Promise<IntercomCanvasContentBuildResult> {
	const [page] = await db
		.select({
			id: statusPage.id,
			slug: statusPage.slug,
			customDomain: statusPage.customDomain,
		})
		.from(statusPage)
		.where(eq(statusPage.id, statusPageId))
		.limit(1);

	if (!page) {
		return { status: 404 };
	}

	const statusPageUrl = buildStatusPageBaseUrl(page);
	if (!statusPageUrl) {
		return { status: 404 };
	}

	const [latestAffection] = await db
		.select({
			id: incidentAffection.id,
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
		return {
			status: 200,
			response: buildAllSystemsOperationalResponse(statusPageUrl),
		};
	}

	return {
		status: 200,
		response: buildActiveAffectionResponse(latestAffection.title, latestAffection.latestMessage?.trim() || "Ongoing incident", buildIncidentUrl(statusPageUrl, latestAffection.id)),
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

export async function resolveIntercomStatusPageId(rawBody: string): Promise<string | null> {
	const payload = parseIntercomCanvasRequest(rawBody);
	if (!payload) {
		return null;
	}

	if (!isCustomerFacingLocation(payload)) {
		return null;
	}

	const workspaceId = extractWorkspaceId(payload);
	if (!workspaceId) {
		return null;
	}

	const installation = await findIntercomInstallationByWorkspaceId(workspaceId);
	if (!installation) {
		return null;
	}

	return normalizeStatusPageId(installation.data.statusPageId);
}

export async function buildIntercomLiveCanvasInitializeResponse(rawBody: string): Promise<IntercomCanvasInitializeBuildResult> {
	const statusPageId = await resolveIntercomStatusPageId(rawBody);
	if (!statusPageId) {
		return { status: 404 };
	}

	const statusDomain = normalizeDomain(process.env.VITE_STATUS_PAGE_DOMAIN ?? null);
	if (!statusDomain) {
		return { status: 404 };
	}

	const contentUrl = `https://${statusDomain}/intercom/${encodeURIComponent(statusPageId)}`;
	return {
		status: 200,
		response: {
			canvas: {
				content_url: contentUrl,
			},
		},
	};
}

export async function buildIntercomCanvasContentResponseByStatusPageId(statusPageId: string): Promise<IntercomCanvasContentBuildResult> {
	const normalizedStatusPageId = normalizeStatusPageId(statusPageId);
	if (!normalizedStatusPageId) {
		return { status: 404 };
	}

	return buildIssueCanvasResponse(normalizedStatusPageId);
}
