import { incidentAffection, incidentAffectionService, incidentAffectionUpdate, service } from "@fire/db/schema";
import { createServerFn } from "@tanstack/solid-start";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { authMiddleware } from "../auth/auth-middleware";
import { requirePermission } from "../auth/authorization";
import { db } from "../db";
import { signedFetch } from "../utils/server";

const AFFECTION_STATUS_ORDER = ["investigating", "mitigating", "resolved"] as const;

export type AffectionStatus = (typeof AFFECTION_STATUS_ORDER)[number];
export type AffectionImpact = "partial" | "major";

export type IncidentAffectionServiceItem = {
	id: string;
	name: string;
	imageUrl: string | null;
	impact: AffectionImpact;
};

export type IncidentAffectionUpdateItem = {
	id: string;
	status: AffectionStatus | null;
	message: string | null;
	createdAt: Date;
	createdBy: string | null;
};

export type IncidentAffectionData = {
	id: string;
	incidentId: string;
	title: string;
	createdAt: Date;
	updatedAt: Date;
	resolvedAt: Date | null;
	currentStatus: AffectionStatus;
	services: IncidentAffectionServiceItem[];
	lastUpdate: IncidentAffectionUpdateItem | null;
};

export type CreateIncidentAffectionInput = {
	incidentId: string;
	title: string;
	services: { id: string; impact: AffectionImpact }[];
	initialMessage: string;
};

export type AddIncidentAffectionUpdateInput = {
	incidentId: string;
	status?: AffectionStatus;
	message: string;
};

export type UpdateIncidentAffectionServicesInput = {
	affectionId: string;
	services: { id: string; impact: AffectionImpact }[];
};

function normalizeServices(services: { id: string; impact: AffectionImpact }[]) {
	const serviceMap = new Map<string, AffectionImpact>();
	for (const entry of services) {
		if (!entry.id) continue;
		serviceMap.set(entry.id, entry.impact);
	}
	return Array.from(serviceMap.entries()).map(([id, impact]) => ({ id, impact }));
}

async function assertIncidentAccess(incidentId: string, context: { clientId: string; userId: string }) {
	const response = await signedFetch(`${process.env.INCIDENTS_URL}/${incidentId}`, { clientId: context.clientId, userId: context.userId });
	if (!response.ok) {
		throw new Error("Incident not found");
	}
	const data = (await response.json()) as { error?: string };
	if (data.error) {
		throw new Error("Incident not found");
	}
}

async function assertAffectionAccess(affectionId: string, clientId: string) {
	const [row] = await db
		.select({
			id: incidentAffection.id,
			incidentId: incidentAffection.incidentId,
			resolvedAt: incidentAffection.resolvedAt,
		})
		.from(incidentAffection)
		.innerJoin(incidentAffectionService, eq(incidentAffectionService.affectionId, incidentAffection.id))
		.innerJoin(service, eq(incidentAffectionService.serviceId, service.id))
		.where(and(eq(incidentAffection.id, affectionId), eq(service.clientId, clientId)))
		.limit(1);

	if (!row) {
		throw new Error("Affection not found");
	}

	return row;
}

export const getIncidentAffection = createServerFn({ method: "GET" })
	.inputValidator((data: { incidentId: string }) => data)
	.middleware([authMiddleware, requirePermission("incident.read")])
	.handler(async ({ data, context }) => {
		const affection = await db.query.incidentAffection.findFirst({
			where: {
				incidentId: data.incidentId,
			},
			columns: {
				id: true,
				incidentId: true,
				title: true,
				createdAt: true,
				updatedAt: true,
				resolvedAt: true,
			},
		});

		if (!affection) {
			return null;
		}

		const services = await db
			.select({
				id: service.id,
				name: service.name,
				imageUrl: service.imageUrl,
				impact: incidentAffectionService.impact,
			})
			.from(incidentAffectionService)
			.innerJoin(service, eq(incidentAffectionService.serviceId, service.id))
			.where(and(eq(incidentAffectionService.affectionId, affection.id), eq(service.clientId, context.clientId)))
			.orderBy(service.name);

		if (services.length === 0) {
			return null;
		}

		const [lastUpdate] = await db
			.select({
				id: incidentAffectionUpdate.id,
				status: incidentAffectionUpdate.status,
				message: incidentAffectionUpdate.message,
				createdAt: incidentAffectionUpdate.createdAt,
				createdBy: incidentAffectionUpdate.createdBy,
			})
			.from(incidentAffectionUpdate)
			.where(eq(incidentAffectionUpdate.affectionId, affection.id))
			.orderBy(desc(incidentAffectionUpdate.createdAt))
			.limit(1);

		const [lastStatus] = await db
			.select({ status: incidentAffectionUpdate.status })
			.from(incidentAffectionUpdate)
			.where(and(eq(incidentAffectionUpdate.affectionId, affection.id), isNotNull(incidentAffectionUpdate.status)))
			.orderBy(desc(incidentAffectionUpdate.createdAt))
			.limit(1);

		const currentStatus = lastStatus?.status ?? "investigating";

		return {
			id: affection.id,
			incidentId: affection.incidentId,
			title: affection.title,
			createdAt: affection.createdAt,
			updatedAt: affection.updatedAt,
			resolvedAt: affection.resolvedAt ?? null,
			currentStatus,
			services,
			lastUpdate: lastUpdate
				? {
						id: lastUpdate.id,
						status: lastUpdate.status,
						message: lastUpdate.message,
						createdAt: lastUpdate.createdAt,
						createdBy: lastUpdate.createdBy,
					}
				: null,
		} satisfies IncidentAffectionData;
	});

export const createIncidentAffection = createServerFn({ method: "POST" })
	.inputValidator((data: CreateIncidentAffectionInput) => data)
	.middleware([authMiddleware, requirePermission("incident.write")])
	.handler(async ({ data, context }) => {
		const title = data.title.trim();
		const initialMessage = data.initialMessage.trim();
		const services = normalizeServices(data.services);

		if (!title) {
			throw new Error("Affection title is required");
		}
		if (!initialMessage) {
			throw new Error("Initial update message is required");
		}
		if (services.length === 0) {
			throw new Error("At least one service is required");
		}

		await assertIncidentAccess(data.incidentId, context);

		const serviceIds = services.map((entry) => entry.id);
		const matchedServices = await db
			.select({ id: service.id })
			.from(service)
			.where(and(inArray(service.id, serviceIds), eq(service.clientId, context.clientId)));

		if (matchedServices.length !== serviceIds.length) {
			throw new Error("One or more services not found");
		}

		const response = await signedFetch(
			`${process.env.INCIDENTS_URL}/${data.incidentId}/affection`,
			{ clientId: context.clientId, userId: context.userId },
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					title,
					services,
					message: initialMessage,
				}),
			},
		);

		if (!response.ok) {
			const payload = (await response.json().catch(() => ({}))) as { error?: string };
			throw new Error(payload.error ?? "Failed to create affection");
		}

		return { success: true };
	});

export const addIncidentAffectionUpdate = createServerFn({ method: "POST" })
	.inputValidator((data: AddIncidentAffectionUpdateInput) => data)
	.middleware([authMiddleware, requirePermission("incident.write")])
	.handler(async ({ data, context }) => {
		const message = data.message.trim();
		if (!message) {
			throw new Error("Update message is required");
		}

		const response = await signedFetch(
			`${process.env.INCIDENTS_URL}/${data.incidentId}/affection/update`,
			{ clientId: context.clientId, userId: context.userId },
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					message,
					...(data.status ? { status: data.status } : {}),
				}),
			},
		);

		if (!response.ok) {
			const payload = (await response.json().catch(() => ({}))) as { error?: string };
			throw new Error(payload.error ?? "Failed to add affection update");
		}

		return { success: true };
	});

export const updateIncidentAffectionServices = createServerFn({ method: "POST" })
	.inputValidator((data: UpdateIncidentAffectionServicesInput) => data)
	.middleware([authMiddleware, requirePermission("incident.write")])
	.handler(async ({ data, context }) => {
		const services = normalizeServices(data.services);
		if (services.length === 0) {
			throw new Error("At least one service is required");
		}

		await assertAffectionAccess(data.affectionId, context.clientId);

		const serviceIds = services.map((entry) => entry.id);
		const matchedServices = await db
			.select({ id: service.id })
			.from(service)
			.where(and(inArray(service.id, serviceIds), eq(service.clientId, context.clientId)));

		if (matchedServices.length !== serviceIds.length) {
			throw new Error("One or more services not found");
		}

		await db.transaction(async (tx) => {
			await tx.delete(incidentAffectionService).where(eq(incidentAffectionService.affectionId, data.affectionId));
			await tx.insert(incidentAffectionService).values(services.map((entry) => ({ affectionId: data.affectionId, serviceId: entry.id, impact: entry.impact })));
			await tx.update(incidentAffection).set({ updatedAt: new Date() }).where(eq(incidentAffection.id, data.affectionId));
		});

		return { success: true };
	});
