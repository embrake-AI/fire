import { service, statusPage, statusPageService } from "@fire/db/schema";
import { createServerFn } from "@tanstack/solid-start";
import type { InferSelectModel } from "drizzle-orm";
import { and, eq, inArray } from "drizzle-orm";
import { authMiddleware } from "../auth/auth-middleware";
import { db } from "../db";
import { addDomainToVercel, getDomainConfig, removeDomainFromVercel } from "../vercel/vercel-domains";
import { isApexDomain, isValidDomain, normalizeDomain } from "./status-pages.utils";

type StatusPageRow = InferSelectModel<typeof statusPage>;
type ServiceRow = InferSelectModel<typeof service>;

export type StatusPageService = Pick<ServiceRow, "id" | "name" | "description" | "imageUrl"> & {
	position: number | null;
	createdAt: Date | null;
};

export type StatusPageSummary = Pick<
	StatusPageRow,
	"id" | "name" | "slug" | "logoUrl" | "faviconUrl" | "serviceDisplayMode" | "customDomain" | "privacyPolicyUrl" | "termsOfServiceUrl" | "createdAt" | "updatedAt"
>;

export type StatusPageListItem = StatusPageSummary & {
	serviceCount: number;
	services: StatusPageService[];
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

function toSlug(value: string) {
	return value
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

export const getStatusPages = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(async ({ context }) => {
		const pages = await db.query.statusPage.findMany({
			where: {
				clientId: context.clientId,
			},
			columns: {
				id: true,
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
			with: {
				serviceLinks: {
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
				},
			},
			orderBy: (table, { desc }) => [desc(table.createdAt)],
		});

		return pages.map((page) => {
			const services: StatusPageService[] = page.serviceLinks
				.filter((link) => link.service)
				.map((link) => ({
					id: link.service!.id,
					name: link.service!.name,
					description: link.service!.description,
					imageUrl: link.service!.imageUrl,
					position: link.position,
					createdAt: link.service!.createdAt,
				}));

			return {
				id: page.id,
				name: page.name,
				slug: page.slug,
				logoUrl: page.logoUrl,
				faviconUrl: page.faviconUrl,
				serviceDisplayMode: page.serviceDisplayMode,
				customDomain: page.customDomain,
				privacyPolicyUrl: page.privacyPolicyUrl,
				termsOfServiceUrl: page.termsOfServiceUrl,
				createdAt: page.createdAt,
				updatedAt: page.updatedAt,
				services: sortStatusPageServices(services),
				serviceCount: services.length,
			};
		});
	});

export const createStatusPage = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { name: string; slug: string }) => data)
	.handler(async ({ context, data }) => {
		const trimmedName = data.name.trim();
		if (!trimmedName) {
			throw new Error("Status page name is required");
		}
		const slug = toSlug(data.slug);
		if (!slug) {
			throw new Error("Status page slug is required");
		}
		const existing = await db.query.statusPage.findFirst({
			where: {
				slug,
			},
			columns: {
				id: true,
			},
		});
		if (existing) {
			throw new Error("Status page slug is already in use");
		}

		const [created] = await db
			.insert(statusPage)
			.values({
				clientId: context.clientId,
				name: trimmedName,
				slug,
			})
			.returning();

		return {
			id: created.id,
			name: created.name,
			slug: created.slug,
			logoUrl: created.logoUrl,
			faviconUrl: created.faviconUrl,
			serviceDisplayMode: created.serviceDisplayMode,
			customDomain: created.customDomain,
			privacyPolicyUrl: created.privacyPolicyUrl,
			termsOfServiceUrl: created.termsOfServiceUrl,
			createdAt: created.createdAt,
			updatedAt: created.updatedAt,
			services: [],
			serviceCount: 0,
		};
	});

export const updateStatusPage = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator(
		(data: {
			id: string;
			name?: string;
			slug?: string;
			logoUrl?: string | null;
			faviconUrl?: string | null;
			serviceDisplayMode?: string | null;
			customDomain?: string | null;
			privacyPolicyUrl?: string | null;
			termsOfServiceUrl?: string | null;
		}) => data,
	)
	.handler(async ({ context, data }) => {
		const updateFields: {
			name?: string;
			slug?: string;
			logoUrl?: string | null;
			faviconUrl?: string | null;
			serviceDisplayMode?: string | null;
			customDomain?: string | null;
			privacyPolicyUrl?: string | null;
			termsOfServiceUrl?: string | null;
		} = {};
		if (data.name !== undefined) {
			const trimmedName = data.name.trim();
			if (!trimmedName) {
				throw new Error("Status page name is required");
			}
			updateFields.name = trimmedName;
		}
		if (data.slug !== undefined) {
			const nextSlug = toSlug(data.slug);
			if (!nextSlug) {
				throw new Error("Status page slug is required");
			}
			const existing = await db.query.statusPage.findFirst({
				where: {
					slug: nextSlug,
				},
				columns: {
					id: true,
				},
			});
			if (existing && existing.id !== data.id) {
				throw new Error("Status page slug is already in use");
			}
			updateFields.slug = nextSlug;
		}
		if (data.logoUrl !== undefined) {
			updateFields.logoUrl = data.logoUrl;
		}
		if (data.faviconUrl !== undefined) {
			updateFields.faviconUrl = data.faviconUrl;
		}
		if (data.serviceDisplayMode !== undefined) {
			updateFields.serviceDisplayMode = data.serviceDisplayMode;
		}
		if (data.customDomain !== undefined) {
			const normalizedDomain = normalizeDomain(data.customDomain);
			if (normalizedDomain && !isValidDomain(normalizedDomain)) {
				throw new Error("Custom domain is invalid");
			}
			if (normalizedDomain && isApexDomain(normalizedDomain)) {
				throw new Error("Apex domains are not supported. Please use a subdomain (e.g., status.example.com)");
			}
			if (normalizedDomain) {
				const existing = await db.query.statusPage.findFirst({
					where: {
						customDomain: normalizedDomain,
					},
					columns: {
						id: true,
					},
				});
				if (existing && existing.id !== data.id) {
					throw new Error("Custom domain is already in use");
				}
			}

			const currentPage = await db.query.statusPage.findFirst({
				where: {
					id: data.id,
					clientId: context.clientId,
				},
				columns: {
					customDomain: true,
				},
			});
			const currentDomain = normalizeDomain(currentPage?.customDomain);

			if (currentDomain && currentDomain !== normalizedDomain) {
				await removeDomainFromVercel(currentDomain);
			}

			if (normalizedDomain && normalizedDomain !== currentDomain) {
				await addDomainToVercel(normalizedDomain);
			}

			updateFields.customDomain = normalizedDomain;
		}
		if (data.privacyPolicyUrl !== undefined) {
			updateFields.privacyPolicyUrl = data.privacyPolicyUrl?.trim() || null;
		}
		if (data.termsOfServiceUrl !== undefined) {
			updateFields.termsOfServiceUrl = data.termsOfServiceUrl?.trim() || null;
		}

		const [updated] = await db
			.update(statusPage)
			.set(updateFields)
			.where(and(eq(statusPage.id, data.id), eq(statusPage.clientId, context.clientId)))
			.returning();

		if (!updated) {
			throw new Error("Status page not found");
		}

		return {
			id: updated.id,
			name: updated.name,
			slug: updated.slug,
			logoUrl: updated.logoUrl,
			faviconUrl: updated.faviconUrl,
			serviceDisplayMode: updated.serviceDisplayMode,
			customDomain: updated.customDomain,
			privacyPolicyUrl: updated.privacyPolicyUrl,
			termsOfServiceUrl: updated.termsOfServiceUrl,
			updatedAt: updated.updatedAt,
		};
	});

export const deleteStatusPage = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { id: string }) => data)
	.handler(async ({ context, data }) => {
		const result = await db
			.delete(statusPage)
			.where(and(eq(statusPage.id, data.id), eq(statusPage.clientId, context.clientId)))
			.returning({ id: statusPage.id });

		if (result.length === 0) {
			throw new Error("Status page not found");
		}

		return { success: true };
	});

export const updateStatusPageServices = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { id: string; serviceIds: string[] }) => data)
	.handler(async ({ context, data }) => {
		const page = await db.query.statusPage.findFirst({
			where: {
				id: data.id,
				clientId: context.clientId,
			},
			columns: {
				id: true,
			},
		});

		if (!page) {
			throw new Error("Status page not found");
		}

		const seen = new Set<string>();
		const orderedServiceIds = data.serviceIds.filter((id) => {
			if (seen.has(id)) return false;
			seen.add(id);
			return true;
		});

		if (orderedServiceIds.length > 0) {
			const existingServices = await db
				.select({ id: service.id })
				.from(service)
				.where(and(inArray(service.id, orderedServiceIds), eq(service.clientId, context.clientId)));

			if (existingServices.length !== orderedServiceIds.length) {
				throw new Error("One or more services not found");
			}
		}

		await db.transaction(async (tx) => {
			await tx.delete(statusPageService).where(eq(statusPageService.statusPageId, data.id));

			if (orderedServiceIds.length > 0) {
				await tx.insert(statusPageService).values(
					orderedServiceIds.map((serviceId, index) => ({
						statusPageId: data.id,
						serviceId,
						position: index,
					})),
				);
			}
		});

		return { success: true };
	});

export const verifyCustomDomain = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: { id: string }) => data)
	.handler(async ({ context, data }) => {
		const page = await db.query.statusPage.findFirst({
			where: {
				id: data.id,
				clientId: context.clientId,
			},
			columns: {
				id: true,
				customDomain: true,
			},
		});

		if (!page) {
			throw new Error("Status page not found");
		}

		const domain = normalizeDomain(page.customDomain);
		if (!domain) {
			throw new Error("No custom domain configured");
		}

		const config = await getDomainConfig(domain);
		return {
			domain,
			verified: config.verified,
			misconfigured: config.misconfigured,
		};
	});
