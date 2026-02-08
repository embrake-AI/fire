import type { incidentAffection, incidentAffectionService, incidentAffectionUpdate, service, statusPage } from "@fire/db/schema";
import { type InferSelectModel, sql } from "drizzle-orm";
import { db } from "./db";
import { normalizeDomain } from "./status-pages.utils";

type StatusPageRow = InferSelectModel<typeof statusPage>;
type ServiceRow = InferSelectModel<typeof service>;
type IncidentAffectionRow = InferSelectModel<typeof incidentAffection>;
type IncidentAffectionServiceRow = InferSelectModel<typeof incidentAffectionService>;
type IncidentAffectionUpdateRow = InferSelectModel<typeof incidentAffectionUpdate>;

const PUBLIC_PAGE_COLUMNS = {
	id: true,
	clientId: true,
	name: true,
	slug: true,
	logoUrl: true,
	faviconUrl: true,
	serviceDisplayMode: true,
	customDomain: true,
	privacyPolicyUrl: true,
	supportUrl: true,
	termsOfServiceUrl: true,
	createdAt: true,
	updatedAt: true,
} as const;

const INCIDENT_DETAIL_PAGE_COLUMNS = {
	id: true,
	clientId: true,
	name: true,
	slug: true,
	logoUrl: true,
	faviconUrl: true,
	serviceDisplayMode: true,
	supportUrl: true,
	privacyPolicyUrl: true,
	termsOfServiceUrl: true,
	createdAt: true,
	updatedAt: true,
} as const;

const SNAPSHOT_PAGE_COLUMNS = {
	id: true,
	name: true,
	slug: true,
	createdAt: true,
	updatedAt: true,
} as const;

export type StatusPageService = Pick<ServiceRow, "id" | "name" | "imageUrl"> & {
	position: number | null;
	createdAt: Date | null;
	description: string | null;
};

export type StatusPageSummary = Pick<
	StatusPageRow,
	"id" | "name" | "slug" | "logoUrl" | "faviconUrl" | "serviceDisplayMode" | "supportUrl" | "privacyPolicyUrl" | "termsOfServiceUrl" | "createdAt" | "updatedAt"
> & {
	clientImage: string | null;
};

export type StatusPageAffection = Pick<IncidentAffectionRow, "id" | "incidentId" | "title" | "createdAt" | "updatedAt" | "resolvedAt"> & {
	services: { id: ServiceRow["id"]; impact: IncidentAffectionServiceRow["impact"] }[];
};

export type StatusPageAffectionUpdate = Pick<IncidentAffectionUpdateRow, "id" | "affectionId" | "status" | "message" | "createdAt" | "createdBy">;

export type StatusPagePublicData = {
	page: StatusPageSummary;
	services: StatusPageService[];
	affections: StatusPageAffection[];
	updates: StatusPageAffectionUpdate[];
};

function sortStatusPageServices(services: StatusPageService[]) {
	return [...services].sort((a, b) => {
		if (a.position == null && b.position == null) {
			return a.name.localeCompare(b.name);
		}
		if (a.position == null) return 1;
		if (b.position == null) return -1;
		if (a.position !== b.position) return a.position - b.position;
		return a.name.localeCompare(b.name);
	});
}

async function buildStatusPagePublicData(pageRow: StatusPageRow): Promise<StatusPagePublicData> {
	// Phase 1: load page metadata and linked services.
	const [client, serviceLinks] = await Promise.all([
		db.query.client.findFirst({
			where: { id: pageRow.clientId },
			columns: { image: true },
		}),
		db.query.statusPageService.findMany({
			where: { statusPageId: pageRow.id },
			columns: { position: true, description: true },
			with: {
				service: {
					columns: { id: true, name: true, imageUrl: true, createdAt: true },
				},
			},
			orderBy: (table, { asc }) => [asc(table.position)],
		}),
	]);

	const page: StatusPageSummary = {
		id: pageRow.id,
		name: pageRow.name,
		slug: pageRow.slug,
		logoUrl: pageRow.logoUrl,
		faviconUrl: pageRow.faviconUrl,
		serviceDisplayMode: pageRow.serviceDisplayMode,
		supportUrl: pageRow.supportUrl,
		privacyPolicyUrl: pageRow.privacyPolicyUrl,
		termsOfServiceUrl: pageRow.termsOfServiceUrl,
		createdAt: pageRow.createdAt,
		updatedAt: pageRow.updatedAt,
		clientImage: client?.image ?? null,
	};

	const mappedServices: StatusPageService[] = [];
	for (const link of serviceLinks) {
		if (!link.service) continue;
		mappedServices.push({
			id: link.service.id,
			name: link.service.name,
			description: link.description,
			imageUrl: link.service.imageUrl,
			position: link.position,
			createdAt: link.service.createdAt,
		});
	}
	const services = sortStatusPageServices(mappedServices);

	const serviceIds = services.map((service) => service.id);
	if (serviceIds.length === 0) {
		return { page, services, affections: [], updates: [] };
	}

	// Phase 2: load incident affections that touch those services.
	const serviceAffections = await db.query.incidentAffectionService.findMany({
		where: { serviceId: { in: serviceIds } },
		columns: { serviceId: true, impact: true },
		with: {
			affection: {
				columns: { id: true, incidentId: true, title: true, createdAt: true, updatedAt: true, resolvedAt: true },
			},
		},
	});

	const affectionMap = new Map<string, StatusPageAffection>();
	for (const row of serviceAffections) {
		const affection = row.affection;
		if (!affection) {
			continue;
		}
		const existing = affectionMap.get(affection.id);
		if (existing) {
			existing.services.push({ id: row.serviceId, impact: row.impact });
			continue;
		}
		affectionMap.set(affection.id, {
			id: affection.id,
			incidentId: affection.incidentId,
			title: affection.title,
			createdAt: affection.createdAt,
			updatedAt: affection.updatedAt,
			resolvedAt: affection.resolvedAt ?? null,
			services: [{ id: row.serviceId, impact: row.impact }],
		});
	}

	const affections = Array.from(affectionMap.values());
	const affectionIds = affections.map((affection) => affection.id);
	if (affectionIds.length === 0) {
		return { page, services, affections, updates: [] };
	}

	// Phase 3: load updates once for all matched affections.
	const updates = await db.query.incidentAffectionUpdate.findMany({
		where: { affectionId: { in: affectionIds } },
		columns: { id: true, affectionId: true, status: true, message: true, createdAt: true, createdBy: true },
		orderBy: (table, { asc }) => [asc(table.createdAt)],
	});

	return { page, services, affections, updates };
}

export async function fetchPublicStatusPageBySlug(slug: string): Promise<StatusPagePublicData | null> {
	const pageRow = await db.query.statusPage.findFirst({
		where: { slug },
		columns: PUBLIC_PAGE_COLUMNS,
	});

	if (!pageRow) {
		return null;
	}

	return buildStatusPagePublicData(pageRow);
}

export async function fetchPublicStatusPageByDomain(domain: string): Promise<StatusPagePublicData | null> {
	const normalizedDomain = normalizeDomain(domain);
	if (!normalizedDomain) {
		return null;
	}

	const pageRow = await db.query.statusPage.findFirst({
		where: { customDomain: normalizedDomain },
		columns: PUBLIC_PAGE_COLUMNS,
	});

	if (!pageRow) {
		return null;
	}

	return buildStatusPagePublicData(pageRow);
}

export type IncidentHistoryItem = {
	id: string;
	title: string;
	severity: "partial" | "major";
	createdAt: Date;
	resolvedAt: Date | null;
	lastUpdate: {
		status: "investigating" | "mitigating" | "resolved" | null;
		message: string | null;
		createdAt: Date;
	} | null;
};

export type IncidentHistoryData = {
	page: StatusPageSummary;
	incidents: IncidentHistoryItem[];
};

function buildIncidentHistoryData(data: StatusPagePublicData): IncidentHistoryData {
	const incidents: IncidentHistoryItem[] = data.affections
		.map((affection) => {
			const severity: "partial" | "major" = affection.services.some((s) => s.impact === "major") ? "major" : "partial";
			const affectionUpdates = data.updates.filter((u) => u.affectionId === affection.id).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
			const lastUpdate = affectionUpdates[0] ?? null;

			return {
				id: affection.id,
				title: affection.title,
				severity,
				createdAt: affection.createdAt,
				resolvedAt: affection.resolvedAt,
				lastUpdate: lastUpdate
					? {
							status: lastUpdate.status,
							message: lastUpdate.message,
							createdAt: lastUpdate.createdAt,
						}
					: null,
			};
		})
		.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

	return { page: data.page, incidents };
}

export async function fetchIncidentHistoryByDomain(domain: string): Promise<IncidentHistoryData | null> {
	const data = await fetchPublicStatusPageByDomain(domain);
	if (!data) {
		return null;
	}

	return buildIncidentHistoryData(data);
}

export async function fetchIncidentHistoryBySlug(slug: string): Promise<IncidentHistoryData | null> {
	const data = await fetchPublicStatusPageBySlug(slug);
	if (!data) {
		return null;
	}

	return buildIncidentHistoryData(data);
}

export type IncidentDetailUpdate = {
	id: string;
	status: "investigating" | "mitigating" | "resolved" | null;
	message: string | null;
	createdAt: Date;
};

export type IncidentDetailData = {
	page: StatusPageSummary;
	incident: {
		id: string;
		title: string;
		severity: "partial" | "major";
		createdAt: Date;
		resolvedAt: Date | null;
		affectedServices: { id: string; name: string; impact: "partial" | "major" }[];
		updates: IncidentDetailUpdate[];
	};
};

async function fetchIncidentDetailDirect(
	pageRow: Pick<
		StatusPageRow,
		"id" | "clientId" | "name" | "slug" | "logoUrl" | "faviconUrl" | "serviceDisplayMode" | "supportUrl" | "privacyPolicyUrl" | "termsOfServiceUrl" | "createdAt" | "updatedAt"
	>,
	incidentId: string,
): Promise<IncidentDetailData | null> {
	// Phase 1: load page metadata and service IDs for this status page.
	const [client, pageServices] = await Promise.all([
		db.query.client.findFirst({
			where: { id: pageRow.clientId },
			columns: { image: true },
		}),
		db.query.statusPageService.findMany({
			where: { statusPageId: pageRow.id },
			columns: { serviceId: true },
		}),
	]);

	const page: StatusPageSummary = {
		id: pageRow.id,
		name: pageRow.name,
		slug: pageRow.slug,
		logoUrl: pageRow.logoUrl,
		faviconUrl: pageRow.faviconUrl,
		serviceDisplayMode: pageRow.serviceDisplayMode,
		supportUrl: pageRow.supportUrl,
		privacyPolicyUrl: pageRow.privacyPolicyUrl,
		termsOfServiceUrl: pageRow.termsOfServiceUrl,
		createdAt: pageRow.createdAt,
		updatedAt: pageRow.updatedAt,
		clientImage: client?.image ?? null,
	};

	const serviceIds = pageServices.map((serviceLink) => serviceLink.serviceId);
	if (serviceIds.length === 0) {
		return null;
	}

	// Phase 2: load the requested incident (scoped to page services) plus its updates.
	const [serviceAffections, updateRows] = await Promise.all([
		db.query.incidentAffectionService.findMany({
			where: { affectionId: incidentId, serviceId: { in: serviceIds } },
			columns: { serviceId: true, impact: true },
			with: {
				service: {
					columns: { id: true, name: true },
				},
				affection: {
					columns: { id: true, title: true, createdAt: true, resolvedAt: true },
				},
			},
		}),
		db.query.incidentAffectionUpdate.findMany({
			where: { affectionId: incidentId },
			columns: { id: true, status: true, message: true, createdAt: true },
			orderBy: (table, { desc }) => [desc(table.createdAt)],
		}),
	]);
	if (serviceAffections.length === 0) {
		return null;
	}

	const affection = serviceAffections[0]?.affection;
	if (!affection) {
		return null;
	}

	const severity: "partial" | "major" = serviceAffections.some((service) => service.impact === "major") ? "major" : "partial";
	const affectedServices = serviceAffections.map((service) => ({
		id: service.serviceId,
		name: service.service?.name ?? "Unknown Service",
		impact: service.impact,
	}));

	const updates = updateRows.map((update) => ({
		id: update.id,
		status: update.status,
		message: update.message,
		createdAt: update.createdAt,
	}));

	return {
		page,
		incident: {
			id: affection.id,
			title: affection.title,
			severity,
			createdAt: affection.createdAt,
			resolvedAt: affection.resolvedAt,
			affectedServices,
			updates,
		},
	};
}

export async function fetchIncidentDetailByDomain(domain: string, incidentId: string): Promise<IncidentDetailData | null> {
	const normalizedDomain = normalizeDomain(domain);
	if (!normalizedDomain) {
		return null;
	}

	const pageRow = await db.query.statusPage.findFirst({
		where: { customDomain: normalizedDomain },
		columns: INCIDENT_DETAIL_PAGE_COLUMNS,
	});
	if (!pageRow) {
		return null;
	}

	return fetchIncidentDetailDirect(pageRow, incidentId);
}

export async function fetchIncidentDetailBySlug(slug: string, incidentId: string): Promise<IncidentDetailData | null> {
	const pageRow = await db.query.statusPage.findFirst({
		where: { slug },
		columns: INCIDENT_DETAIL_PAGE_COLUMNS,
	});
	if (!pageRow) {
		return null;
	}

	return fetchIncidentDetailDirect(pageRow, incidentId);
}

export type StatusSnapshotData = {
	page: Pick<StatusPageSummary, "id" | "name" | "slug">;
	overallStatus: "operational" | "issues";
	hasActiveIncidents: boolean;
	activeIncidentCount: number;
	activeMajorIncidentCount: number;
	activePartialIncidentCount: number;
	totalIncidentCount: number;
	lastUpdatedAt: Date;
	version: string;
};

function toTimestamp(date: Date | null | undefined): number | null {
	if (!date) {
		return null;
	}
	const value = new Date(date).getTime();
	return Number.isFinite(value) ? value : null;
}

export type LiveStatusInfo = {
	indicator: "none" | "minor" | "major";
	description: string;
	lastUpdatedAt: Date;
	version: string;
};

export function getStatusDescription(indicator: "none" | "minor" | "major"): string {
	if (indicator === "major") return "Major Service Outage";
	if (indicator === "minor") return "Some Systems Experiencing Issues";
	return "All Systems Operational";
}

export function computeLiveStatusInfo(data: StatusPagePublicData, fallbackTimestamp?: number): LiveStatusInfo {
	const activeAffections = data.affections.filter((a) => !a.resolvedAt);
	const hasMajorIssue = activeAffections.some((a) => a.services.some((s) => s.impact === "major"));
	const indicator: "none" | "minor" | "major" = hasMajorIssue ? "major" : activeAffections.length > 0 ? "minor" : "none";
	const description = getStatusDescription(indicator);

	const timestamps: number[] = [];
	const push = (date: Date | null | undefined) => {
		const value = toTimestamp(date);
		if (value !== null) timestamps.push(value);
	};

	push(data.page.createdAt);
	push(data.page.updatedAt);
	for (const affection of data.affections) {
		push(affection.createdAt);
		push(affection.updatedAt);
		push(affection.resolvedAt);
	}
	for (const update of data.updates) {
		push(update.createdAt);
	}

	const lastUpdatedAt = new Date(timestamps.length > 0 ? Math.max(...timestamps) : (fallbackTimestamp ?? Date.now()));
	const version = `${lastUpdatedAt.getTime()}-${activeAffections.length}-${data.updates.length}-${data.affections.length}`;

	return { indicator, description, lastUpdatedAt, version };
}

type SnapshotAggregateRow = {
	total_affection_count: string;
	active_count: string;
	active_major_count: string;
	total_update_count: string;
	max_event_ts: string | null;
};

async function fetchStatusSnapshotDirect(pageRow: Pick<StatusPageRow, "id" | "name" | "slug" | "createdAt" | "updatedAt">): Promise<StatusSnapshotData> {
	const { rows } = await db.execute<SnapshotAggregateRow>(sql`
		WITH page_affections AS (
			SELECT DISTINCT ia.id, ia.created_at, ia.updated_at, ia.resolved_at,
				BOOL_OR(ias.impact = 'major') as has_major
			FROM status_page_service sps
			JOIN incident_affection_service ias ON ias.service_id = sps.service_id
			JOIN incident_affection ia ON ia.id = ias.affection_id
			WHERE sps.status_page_id = ${pageRow.id}
			GROUP BY ia.id, ia.created_at, ia.updated_at, ia.resolved_at
		)
		SELECT
			COALESCE(COUNT(*), 0) as total_affection_count,
			COALESCE(COUNT(*) FILTER (WHERE resolved_at IS NULL), 0) as active_count,
			COALESCE(COUNT(*) FILTER (WHERE resolved_at IS NULL AND has_major), 0) as active_major_count,
			(SELECT COALESCE(COUNT(*), 0) FROM incident_affection_update
			 WHERE affection_id IN (SELECT id FROM page_affections)) as total_update_count,
			GREATEST(
				MAX(created_at), MAX(updated_at), MAX(resolved_at),
				(SELECT MAX(created_at) FROM incident_affection_update
				 WHERE affection_id IN (SELECT id FROM page_affections))
			) as max_event_ts
		FROM page_affections
	`);

	const row = rows[0];
	const totalAffectionCount = Number(row?.total_affection_count ?? 0);
	const activeCount = Number(row?.active_count ?? 0);
	const activeMajorCount = Number(row?.active_major_count ?? 0);
	const activePartialCount = activeCount - activeMajorCount;
	const totalUpdateCount = Number(row?.total_update_count ?? 0);

	const candidates = [toTimestamp(pageRow.createdAt), toTimestamp(pageRow.updatedAt), row?.max_event_ts ? new Date(row.max_event_ts).getTime() : null].filter(
		(v): v is number => v !== null && Number.isFinite(v),
	);

	const lastUpdatedAt = new Date(candidates.length > 0 ? Math.max(...candidates) : Date.now());
	const version = `${lastUpdatedAt.getTime()}-${activeCount}-${totalUpdateCount}-${totalAffectionCount}`;

	return {
		page: { id: pageRow.id, name: pageRow.name, slug: pageRow.slug },
		overallStatus: activeCount > 0 ? "issues" : "operational",
		hasActiveIncidents: activeCount > 0,
		activeIncidentCount: activeCount,
		activeMajorIncidentCount: activeMajorCount,
		activePartialIncidentCount: activePartialCount,
		totalIncidentCount: totalAffectionCount,
		lastUpdatedAt,
		version,
	};
}

export async function fetchStatusSnapshotByDomain(domain: string): Promise<StatusSnapshotData | null> {
	const normalizedDomain = normalizeDomain(domain);
	if (!normalizedDomain) {
		return null;
	}

	const pageRow = await db.query.statusPage.findFirst({
		where: { customDomain: normalizedDomain },
		columns: SNAPSHOT_PAGE_COLUMNS,
	});
	if (!pageRow) {
		return null;
	}

	return fetchStatusSnapshotDirect(pageRow);
}

export async function fetchStatusSnapshotBySlug(slug: string): Promise<StatusSnapshotData | null> {
	const pageRow = await db.query.statusPage.findFirst({
		where: { slug },
		columns: SNAPSHOT_PAGE_COLUMNS,
	});
	if (!pageRow) {
		return null;
	}

	return fetchStatusSnapshotDirect(pageRow);
}
