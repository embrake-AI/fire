import type { incidentAffection, incidentAffectionService, incidentAffectionUpdate, service, statusPage } from "@fire/db/schema";
import type { InferSelectModel } from "drizzle-orm";
import { db } from "./db";
import { normalizeDomain } from "./status-pages.utils";

type StatusPageRow = InferSelectModel<typeof statusPage>;
type ServiceRow = InferSelectModel<typeof service>;
type IncidentAffectionRow = InferSelectModel<typeof incidentAffection>;
type IncidentAffectionServiceRow = InferSelectModel<typeof incidentAffectionService>;
type IncidentAffectionUpdateRow = InferSelectModel<typeof incidentAffectionUpdate>;

export type StatusPageService = Pick<ServiceRow, "id" | "name" | "description" | "imageUrl"> & {
	position: number | null;
	createdAt: Date | null;
};

export type StatusPageSummary = Pick<
	StatusPageRow,
	"id" | "name" | "slug" | "logoUrl" | "faviconUrl" | "serviceDisplayMode" | "privacyPolicyUrl" | "termsOfServiceUrl" | "createdAt" | "updatedAt"
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
	const client = await db.query.client.findFirst({
		where: {
			id: pageRow.clientId,
		},
		columns: {
			image: true,
		},
	});

	const page: StatusPageSummary = {
		id: pageRow.id,
		name: pageRow.name,
		slug: pageRow.slug,
		logoUrl: pageRow.logoUrl,
		faviconUrl: pageRow.faviconUrl,
		serviceDisplayMode: pageRow.serviceDisplayMode,
		privacyPolicyUrl: pageRow.privacyPolicyUrl,
		termsOfServiceUrl: pageRow.termsOfServiceUrl,
		createdAt: pageRow.createdAt,
		updatedAt: pageRow.updatedAt,
		clientImage: client?.image ?? null,
	};

	const services = await db.query.statusPageService.findMany({
		where: {
			statusPageId: page.id,
		},
		columns: {
			position: true,
		},
		with: {
			service: {
				columns: {
					id: true,
					name: true,
					description: true,
					imageUrl: true,
					createdAt: true,
				},
			},
		},
		orderBy: (table, { asc }) => [asc(table.position)],
	});

	const serviceRows = services
		.map((row) => {
			if (!row.service) return null;
			return {
				id: row.service.id,
				name: row.service.name,
				description: row.service.description,
				imageUrl: row.service.imageUrl,
				position: row.position,
				createdAt: row.service.createdAt,
			};
		})
		.filter((row): row is NonNullable<typeof row> => row !== null);
	const sortedServiceRows = sortStatusPageServices(serviceRows);

	const serviceIds = sortedServiceRows.map((row) => row.id);
	if (serviceIds.length === 0) {
		return { page, services: sortedServiceRows, affections: [], updates: [] } satisfies StatusPagePublicData;
	}

	const affectionRows = await db.query.incidentAffectionService.findMany({
		where: {
			serviceId: {
				in: serviceIds,
			},
		},
		columns: {
			serviceId: true,
			impact: true,
		},
		with: {
			affection: {
				columns: {
					id: true,
					incidentId: true,
					title: true,
					createdAt: true,
					updatedAt: true,
					resolvedAt: true,
				},
			},
		},
	});

	const affectionMap = new Map<string, StatusPageAffection>();
	for (const row of affectionRows) {
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
		return { page, services: sortedServiceRows, affections, updates: [] } satisfies StatusPagePublicData;
	}

	const updates = await db.query.incidentAffectionUpdate.findMany({
		where: {
			affectionId: {
				in: affectionIds,
			},
		},
		columns: {
			id: true,
			affectionId: true,
			status: true,
			message: true,
			createdAt: true,
			createdBy: true,
		},
		orderBy: (table, { asc }) => [asc(table.createdAt)],
	});

	return { page, services: sortedServiceRows, affections, updates } satisfies StatusPagePublicData;
}

export async function fetchPublicStatusPageBySlug(slug: string): Promise<StatusPagePublicData | null> {
	const pageRow = await db.query.statusPage.findFirst({
		where: {
			slug,
		},
		columns: {
			id: true,
			clientId: true,
			name: true,
			slug: true,
			logoUrl: true,
			faviconUrl: true,
			serviceDisplayMode: true,
			customDomain: true,
			privacyPolicyUrl: true,
			termsOfServiceUrl: true,
			createdAt: true,
			updatedAt: true,
		},
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
		where: {
			customDomain: normalizedDomain,
		},
		columns: {
			id: true,
			clientId: true,
			name: true,
			slug: true,
			logoUrl: true,
			faviconUrl: true,
			serviceDisplayMode: true,
			customDomain: true,
			privacyPolicyUrl: true,
			termsOfServiceUrl: true,
			createdAt: true,
			updatedAt: true,
		},
	});

	if (!pageRow) {
		return null;
	}

	return buildStatusPagePublicData(pageRow);
}
