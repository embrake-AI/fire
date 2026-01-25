import { service, serviceDependency, serviceTeamOwner, serviceUserOwner, team, teamMember, user } from "@fire/db/schema";
import { createServerFn } from "@tanstack/solid-start";
import { and, eq, inArray } from "drizzle-orm";
import { authMiddleware } from "../auth/auth-middleware";
import { db } from "../db";

export const getServices = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(async ({ context }) => {
		const services = await db.query.service.findMany({
			columns: {
				id: true,
				name: true,
				description: true,
				prompt: true,
				imageUrl: true,
				createdAt: true,
				updatedAt: true,
			},
			where: {
				clientId: context.clientId,
			},
			with: {
				teamOwners: {
					columns: {
						id: true,
					},
				},
				userOwners: {
					columns: {
						id: true,
					},
				},
				affectsServices: {
					columns: {
						id: true,
					},
				},
				affectedByServices: {
					columns: {
						id: true,
					},
				},
			},
			orderBy: (services, { desc }) => [desc(services.createdAt)],
		});

		return services.map((service) => ({
			id: service.id,
			name: service.name,
			description: service.description,
			prompt: service.prompt,
			imageUrl: service.imageUrl,
			createdAt: service.createdAt,
			updatedAt: service.updatedAt,
			teamOwnerIds: service.teamOwners.map((team) => team.id),
			userOwnerIds: service.userOwners.map((user) => user.id),
			affectsServiceIds: service.affectsServices.map((linked) => linked.id),
			affectedByServiceIds: service.affectedByServices.map((linked) => linked.id),
		}));
	});

export type CreateServiceInput = {
	name?: string;
	description?: string | null;
	prompt?: string | null;
	teamOwnerIds?: string[];
};

export const createService = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: CreateServiceInput) => data)
	.handler(async ({ data, context }) => {
		const trimmedName = data.name?.trim() ?? "";
		const trimmedDescription = data.description?.trim() ?? "";
		const trimmedPrompt = data.prompt?.trim() ?? "";
		const teamOwnerIds = Array.from(new Set(data.teamOwnerIds ?? []));

		const newService = await db.transaction(async (tx) => {
			const [created] = await tx
				.insert(service)
				.values({
					clientId: context.clientId,
					name: trimmedName,
					description: trimmedDescription ? trimmedDescription : null,
					prompt: trimmedPrompt ? trimmedPrompt : null,
				})
				.returning();

			if (teamOwnerIds.length > 0) {
				const teamMatches = await tx
					.select({ id: team.id })
					.from(team)
					.where(and(inArray(team.id, teamOwnerIds), eq(team.clientId, context.clientId)));

				if (teamMatches.length !== teamOwnerIds.length) {
					throw new Error("One or more teams not found");
				}

				await tx.insert(serviceTeamOwner).values(teamOwnerIds.map((teamId) => ({ serviceId: created.id, teamId })));
			}

			return created;
		});

		return {
			id: newService.id,
			name: newService.name,
			description: newService.description,
			prompt: newService.prompt,
			imageUrl: newService.imageUrl,
			createdAt: newService.createdAt,
			updatedAt: newService.updatedAt,
			teamOwnerIds,
			userOwnerIds: [],
			affectsServiceIds: [],
			affectedByServiceIds: [],
		};
	});

export const updateService = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { id: string; name?: string; description?: string | null; prompt?: string | null; imageUrl?: string | null }) => data)
	.handler(async ({ data, context }) => {
		const updateFields: { name?: string; description?: string | null; prompt?: string | null; imageUrl?: string | null } = {};
		if (data.name !== undefined) {
			updateFields.name = data.name.trim();
		}
		if (data.description !== undefined) {
			updateFields.description = data.description?.trim() || null;
		}
		if (data.prompt !== undefined) {
			updateFields.prompt = data.prompt?.trim() || null;
		}
		if (data.imageUrl !== undefined) {
			updateFields.imageUrl = data.imageUrl || null;
		}

		const [updated] = await db
			.update(service)
			.set(updateFields)
			.where(and(eq(service.id, data.id), eq(service.clientId, context.clientId)))
			.returning();

		if (!updated) {
			throw new Error("Service not found");
		}

		return {
			id: updated.id,
			name: updated.name,
			description: updated.description,
			prompt: updated.prompt,
			imageUrl: updated.imageUrl,
			updatedAt: updated.updatedAt,
		};
	});

export const deleteService = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { id: string }) => data)
	.handler(async ({ data, context }) => {
		const result = await db
			.delete(service)
			.where(and(eq(service.id, data.id), eq(service.clientId, context.clientId)))
			.returning();

		if (result.length === 0) {
			throw new Error("Service not found");
		}

		return { success: true };
	});

export const addServiceTeamOwner = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { serviceId: string; teamId: string }) => data)
	.handler(async ({ data, context }) => {
		const [existingService] = await db
			.select({ id: service.id })
			.from(service)
			.where(and(eq(service.id, data.serviceId), eq(service.clientId, context.clientId)));

		if (!existingService) {
			throw new Error("Service not found");
		}

		const [existingTeam] = await db
			.select({ id: team.id })
			.from(team)
			.where(and(eq(team.id, data.teamId), eq(team.clientId, context.clientId)));

		if (!existingTeam) {
			throw new Error("Team not found");
		}

		await db.insert(serviceTeamOwner).values({ serviceId: data.serviceId, teamId: data.teamId }).onConflictDoNothing();
		return { success: true };
	});

export const removeServiceTeamOwner = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { serviceId: string; teamId: string }) => data)
	.handler(async ({ data, context }) => {
		const [existingService] = await db
			.select({ id: service.id })
			.from(service)
			.where(and(eq(service.id, data.serviceId), eq(service.clientId, context.clientId)));

		if (!existingService) {
			throw new Error("Service not found");
		}

		await db.delete(serviceTeamOwner).where(and(eq(serviceTeamOwner.serviceId, data.serviceId), eq(serviceTeamOwner.teamId, data.teamId)));
		return { success: true };
	});

export const addServiceUserOwner = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { serviceId: string; userId: string }) => data)
	.handler(async ({ data, context }) => {
		const [existingService] = await db
			.select({ id: service.id })
			.from(service)
			.where(and(eq(service.id, data.serviceId), eq(service.clientId, context.clientId)));

		if (!existingService) {
			throw new Error("Service not found");
		}

		const [existingUser] = await db
			.select({ id: user.id })
			.from(user)
			.where(and(eq(user.id, data.userId), eq(user.clientId, context.clientId)));

		if (!existingUser) {
			throw new Error("User not found");
		}

		const teamOwners = await db.select({ teamId: serviceTeamOwner.teamId }).from(serviceTeamOwner).where(eq(serviceTeamOwner.serviceId, data.serviceId));

		if (teamOwners.length === 0) {
			throw new Error("Add a team owner first");
		}

		const teamOwnerIds = teamOwners.map((owner) => owner.teamId);
		const [membership] = await db
			.select({ id: teamMember.teamId })
			.from(teamMember)
			.where(and(eq(teamMember.userId, data.userId), inArray(teamMember.teamId, teamOwnerIds)))
			.limit(1);

		if (!membership) {
			throw new Error("User is not in a team that owns this service");
		}

		await db.insert(serviceUserOwner).values({ serviceId: data.serviceId, userId: data.userId }).onConflictDoNothing();
		return { success: true };
	});

export const removeServiceUserOwner = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { serviceId: string; userId: string }) => data)
	.handler(async ({ data, context }) => {
		const [existingService] = await db
			.select({ id: service.id })
			.from(service)
			.where(and(eq(service.id, data.serviceId), eq(service.clientId, context.clientId)));

		if (!existingService) {
			throw new Error("Service not found");
		}

		await db.delete(serviceUserOwner).where(and(eq(serviceUserOwner.serviceId, data.serviceId), eq(serviceUserOwner.userId, data.userId)));
		return { success: true };
	});

export const addServiceDependency = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { baseServiceId: string; affectedServiceId: string }) => data)
	.handler(async ({ data, context }) => {
		if (data.baseServiceId === data.affectedServiceId) {
			throw new Error("Service cannot depend on itself");
		}

		const services = await db
			.select({ id: service.id })
			.from(service)
			.where(and(eq(service.clientId, context.clientId), inArray(service.id, [data.baseServiceId, data.affectedServiceId])));

		if (services.length !== 2) {
			throw new Error("Service not found");
		}

		await db.insert(serviceDependency).values({ baseServiceId: data.baseServiceId, affectedServiceId: data.affectedServiceId }).onConflictDoNothing();

		return { success: true };
	});

export const removeServiceDependency = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { baseServiceId: string; affectedServiceId: string }) => data)
	.handler(async ({ data, context }) => {
		if (data.baseServiceId === data.affectedServiceId) {
			throw new Error("Service cannot depend on itself");
		}

		const [existingService] = await db
			.select({ id: service.id })
			.from(service)
			.where(and(eq(service.id, data.baseServiceId), eq(service.clientId, context.clientId)));

		if (!existingService) {
			throw new Error("Service not found");
		}

		await db.delete(serviceDependency).where(and(eq(serviceDependency.baseServiceId, data.baseServiceId), eq(serviceDependency.affectedServiceId, data.affectedServiceId)));

		return { success: true };
	});
