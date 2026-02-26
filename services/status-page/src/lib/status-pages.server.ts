import {
	client as clientTable,
	incidentAffectionService as incidentAffectionServiceTable,
	incidentAffection as incidentAffectionTable,
	type incidentAffectionUpdate as incidentAffectionUpdateTable,
	service as serviceTable,
	statusPageService as statusPageServiceTable,
	statusPage as statusPageTable,
} from "@fire/db/schema";
import { and, eq, type InferSelectModel, sql } from "drizzle-orm";
import { cacheLife } from "next/cache";
import { db } from "./db";
import { normalizeDomain } from "./status-pages.utils";

type StatusPageRow = InferSelectModel<typeof statusPageTable>;
type ServiceRow = InferSelectModel<typeof serviceTable>;
type IncidentAffectionRow = InferSelectModel<typeof incidentAffectionTable>;
type IncidentAffectionServiceRow = InferSelectModel<typeof incidentAffectionServiceTable>;
type IncidentAffectionUpdateRow = InferSelectModel<typeof incidentAffectionUpdateTable>;

const STANDARD_CACHE_LIFE = { revalidate: 30, expire: 60 } as const;
const SNAPSHOT_CACHE_LIFE = { revalidate: 10, expire: 30 } as const;

const SNAPSHOT_PAGE_COLUMNS = {
	id: true,
	name: true,
	slug: true,
	createdAt: true,
	updatedAt: true,
} as const;

type StatusPageLookup = { slug: string } | { domain: string };

type StatusPageContentRow = Pick<
	StatusPageRow,
	"id" | "clientId" | "name" | "slug" | "logoUrl" | "faviconUrl" | "serviceDisplayMode" | "privacyPolicyUrl" | "supportUrl" | "termsOfServiceUrl" | "createdAt" | "updatedAt"
>;

type SnapshotStatusPageRow = Pick<StatusPageRow, "id" | "name" | "slug" | "createdAt" | "updatedAt">;
type StatusPageContentWithClientRow = StatusPageContentRow & { clientImage: string | null };

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

function buildStatusPageSummary(pageRow: StatusPageContentRow, clientImage: string | null): StatusPageSummary {
	return {
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
		clientImage,
	};
}

function resolveStatusPageLookupFilter(lookup: StatusPageLookup) {
	if ("slug" in lookup) {
		return eq(statusPageTable.slug, lookup.slug);
	}

	const normalizedDomain = normalizeDomain(lookup.domain);
	if (!normalizedDomain) {
		return null;
	}

	return eq(statusPageTable.customDomain, normalizedDomain);
}

async function findStatusPageContentWithClientRow(lookup: StatusPageLookup): Promise<StatusPageContentWithClientRow | null> {
	const whereFilter = resolveStatusPageLookupFilter(lookup);
	if (!whereFilter) {
		return null;
	}

	const rows = await db
		.select({
			id: statusPageTable.id,
			clientId: statusPageTable.clientId,
			name: statusPageTable.name,
			slug: statusPageTable.slug,
			logoUrl: statusPageTable.logoUrl,
			faviconUrl: statusPageTable.faviconUrl,
			serviceDisplayMode: statusPageTable.serviceDisplayMode,
			privacyPolicyUrl: statusPageTable.privacyPolicyUrl,
			supportUrl: statusPageTable.supportUrl,
			termsOfServiceUrl: statusPageTable.termsOfServiceUrl,
			createdAt: statusPageTable.createdAt,
			updatedAt: statusPageTable.updatedAt,
			clientImage: clientTable.image,
		})
		.from(statusPageTable)
		.leftJoin(clientTable, eq(clientTable.id, statusPageTable.clientId))
		.where(whereFilter)
		.limit(1);

	return rows[0] ?? null;
}

async function findSnapshotStatusPageRow(lookup: StatusPageLookup): Promise<SnapshotStatusPageRow | null> {
	if ("slug" in lookup) {
		const pageRow = await db.query.statusPage.findFirst({
			where: { slug: lookup.slug },
			columns: SNAPSHOT_PAGE_COLUMNS,
		});
		return pageRow ?? null;
	}

	const normalizedDomain = normalizeDomain(lookup.domain);
	if (!normalizedDomain) {
		return null;
	}

	const pageRow = await db.query.statusPage.findFirst({
		where: { customDomain: normalizedDomain },
		columns: SNAPSHOT_PAGE_COLUMNS,
	});
	return pageRow ?? null;
}

async function buildStatusPagePublicData(pageRow: StatusPageContentWithClientRow): Promise<StatusPagePublicData> {
	const serviceLinks = await db.query.statusPageService.findMany({
		where: { statusPageId: pageRow.id },
		columns: { position: true, description: true },
		with: {
			service: {
				columns: { id: true, name: true, imageUrl: true, createdAt: true },
			},
		},
		orderBy: (table, { asc }) => [asc(table.position)],
	});

	const page = buildStatusPageSummary(pageRow, pageRow.clientImage);

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

async function fetchPublicStatusPageByLookup(lookup: StatusPageLookup): Promise<StatusPagePublicData | null> {
	const pageRow = await findStatusPageContentWithClientRow(lookup);
	if (!pageRow) {
		return null;
	}

	return buildStatusPagePublicData(pageRow);
}

export async function fetchPublicStatusPageBySlug(slug: string): Promise<StatusPagePublicData | null> {
	"use cache";
	cacheLife(STANDARD_CACHE_LIFE);

	return fetchPublicStatusPageByLookup({ slug });
}

export async function fetchPublicStatusPageByDomain(domain: string): Promise<StatusPagePublicData | null> {
	"use cache";
	cacheLife(STANDARD_CACHE_LIFE);

	return fetchPublicStatusPageByLookup({ domain });
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

function getLatestAffectionUpdates<T extends { affectionId: string; createdAt: Date }>(updates: T[]): Map<string, T> {
	const latestByAffectionId = new Map<string, T>();
	for (const update of updates) {
		const current = latestByAffectionId.get(update.affectionId);
		if (!current || update.createdAt.getTime() > current.createdAt.getTime()) {
			latestByAffectionId.set(update.affectionId, update);
		}
	}
	return latestByAffectionId;
}

async function fetchIncidentHistoryByLookup(lookup: StatusPageLookup): Promise<IncidentHistoryData | null> {
	const pageRow = await findStatusPageContentWithClientRow(lookup);
	if (!pageRow) {
		return null;
	}

	const page = buildStatusPageSummary(pageRow, pageRow.clientImage);
	const serviceAffectionRows = await db
		.select({
			affectionId: incidentAffectionTable.id,
			title: incidentAffectionTable.title,
			createdAt: incidentAffectionTable.createdAt,
			resolvedAt: incidentAffectionTable.resolvedAt,
			impact: incidentAffectionServiceTable.impact,
		})
		.from(statusPageServiceTable)
		.innerJoin(incidentAffectionServiceTable, eq(incidentAffectionServiceTable.serviceId, statusPageServiceTable.serviceId))
		.innerJoin(incidentAffectionTable, eq(incidentAffectionTable.id, incidentAffectionServiceTable.affectionId))
		.where(eq(statusPageServiceTable.statusPageId, pageRow.id));

	if (serviceAffectionRows.length === 0) {
		return { page, incidents: [] };
	}

	const incidentMap = new Map<
		string,
		{
			id: string;
			title: string;
			severity: "partial" | "major";
			createdAt: Date;
			resolvedAt: Date | null;
		}
	>();
	for (const row of serviceAffectionRows) {
		const existing = incidentMap.get(row.affectionId);
		if (existing) {
			if (row.impact === "major") {
				existing.severity = "major";
			}
			continue;
		}

		incidentMap.set(row.affectionId, {
			id: row.affectionId,
			title: row.title,
			severity: row.impact === "major" ? "major" : "partial",
			createdAt: row.createdAt,
			resolvedAt: row.resolvedAt,
		});
	}

	const affectionIds = Array.from(incidentMap.keys());
	const updates = await db.query.incidentAffectionUpdate.findMany({
		where: { affectionId: { in: affectionIds } },
		columns: { affectionId: true, status: true, message: true, createdAt: true },
		orderBy: (table, { desc }) => [desc(table.createdAt)],
	});
	const latestUpdatesByAffectionId = getLatestAffectionUpdates(updates);

	const incidents: IncidentHistoryItem[] = Array.from(incidentMap.values())
		.map((incident) => {
			const lastUpdate = latestUpdatesByAffectionId.get(incident.id) ?? null;
			return {
				...incident,
				lastUpdate: lastUpdate
					? {
							status: lastUpdate.status,
							message: lastUpdate.message,
							createdAt: lastUpdate.createdAt,
						}
					: null,
			};
		})
		.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

	return { page, incidents };
}

export async function fetchIncidentHistoryByDomain(domain: string): Promise<IncidentHistoryData | null> {
	"use cache";
	cacheLife(STANDARD_CACHE_LIFE);
	return fetchIncidentHistoryByLookup({ domain });
}

export async function fetchIncidentHistoryBySlug(slug: string): Promise<IncidentHistoryData | null> {
	"use cache";
	cacheLife(STANDARD_CACHE_LIFE);
	return fetchIncidentHistoryByLookup({ slug });
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

async function fetchIncidentDetailDirect(pageRow: StatusPageContentWithClientRow, incidentId: string): Promise<IncidentDetailData | null> {
	const page = buildStatusPageSummary(pageRow, pageRow.clientImage);

	const serviceAffections = await db
		.select({
			affectionId: incidentAffectionTable.id,
			affectionTitle: incidentAffectionTable.title,
			affectionCreatedAt: incidentAffectionTable.createdAt,
			affectionResolvedAt: incidentAffectionTable.resolvedAt,
			serviceId: incidentAffectionServiceTable.serviceId,
			impact: incidentAffectionServiceTable.impact,
			serviceName: serviceTable.name,
		})
		.from(statusPageServiceTable)
		.innerJoin(incidentAffectionServiceTable, eq(incidentAffectionServiceTable.serviceId, statusPageServiceTable.serviceId))
		.innerJoin(incidentAffectionTable, eq(incidentAffectionTable.id, incidentAffectionServiceTable.affectionId))
		.innerJoin(serviceTable, eq(serviceTable.id, incidentAffectionServiceTable.serviceId))
		.where(and(eq(statusPageServiceTable.statusPageId, pageRow.id), eq(incidentAffectionServiceTable.affectionId, incidentId)));
	if (serviceAffections.length === 0) {
		return null;
	}

	const updateRows = await db.query.incidentAffectionUpdate.findMany({
		where: { affectionId: incidentId },
		columns: { id: true, status: true, message: true, createdAt: true },
		orderBy: (table, { desc }) => [desc(table.createdAt)],
	});

	const affection = serviceAffections[0];

	const severity: "partial" | "major" = serviceAffections.some((serviceAffection) => serviceAffection.impact === "major") ? "major" : "partial";
	const affectedServiceMap = new Map<string, { id: string; name: string; impact: "partial" | "major" }>();
	for (const serviceAffection of serviceAffections) {
		if (!affectedServiceMap.has(serviceAffection.serviceId)) {
			affectedServiceMap.set(serviceAffection.serviceId, {
				id: serviceAffection.serviceId,
				name: serviceAffection.serviceName ?? "Unknown Service",
				impact: serviceAffection.impact,
			});
		}
	}
	const affectedServices = Array.from(affectedServiceMap.values());

	const updates = updateRows.map((update) => ({
		id: update.id,
		status: update.status,
		message: update.message,
		createdAt: update.createdAt,
	}));

	return {
		page,
		incident: {
			id: affection.affectionId,
			title: affection.affectionTitle,
			severity,
			createdAt: affection.affectionCreatedAt,
			resolvedAt: affection.affectionResolvedAt,
			affectedServices,
			updates,
		},
	};
}

async function fetchIncidentDetailByLookup(lookup: StatusPageLookup, incidentId: string): Promise<IncidentDetailData | null> {
	const pageRow = await findStatusPageContentWithClientRow(lookup);
	if (!pageRow) {
		return null;
	}

	return fetchIncidentDetailDirect(pageRow, incidentId);
}

export async function fetchIncidentDetailByDomain(domain: string, incidentId: string): Promise<IncidentDetailData | null> {
	"use cache";
	cacheLife(STANDARD_CACHE_LIFE);
	return fetchIncidentDetailByLookup({ domain }, incidentId);
}

export async function fetchIncidentDetailBySlug(slug: string, incidentId: string): Promise<IncidentDetailData | null> {
	"use cache";
	cacheLife(STANDARD_CACHE_LIFE);
	return fetchIncidentDetailByLookup({ slug }, incidentId);
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

async function fetchStatusSnapshotDirect(pageRow: SnapshotStatusPageRow): Promise<StatusSnapshotData> {
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

async function fetchStatusSnapshotByLookup(lookup: StatusPageLookup): Promise<StatusSnapshotData | null> {
	const pageRow = await findSnapshotStatusPageRow(lookup);
	if (!pageRow) {
		return null;
	}

	return fetchStatusSnapshotDirect(pageRow);
}

export async function fetchStatusSnapshotByDomain(domain: string): Promise<StatusSnapshotData | null> {
	"use cache";
	cacheLife(SNAPSHOT_CACHE_LIFE);
	return fetchStatusSnapshotByLookup({ domain });
}

export async function fetchStatusSnapshotBySlug(slug: string): Promise<StatusSnapshotData | null> {
	"use cache";
	cacheLife(SNAPSHOT_CACHE_LIFE);
	return fetchStatusSnapshotByLookup({ slug });
}
