import { client, incidentAffectionService, incidentAffectionUpdate, incidentAnalysis, rotation, rotationMember, statusPage, statusPageService, user } from "@fire/db/schema";
import { createServerFn } from "@tanstack/solid-start";
import { asc, count, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { createUserFacingError } from "../errors/user-facing-error";
import { authMiddleware } from "./auth-middleware";
import { requirePermission } from "./authorization";

function toCountValue(value: unknown): number {
	if (typeof value === "number") return value;
	if (typeof value === "bigint") return Number(value);
	if (typeof value === "string") return Number.parseInt(value, 10) || 0;
	return 0;
}

export const getSuperAdminClients = createServerFn({ method: "GET" })
	.middleware([authMiddleware, requirePermission("impersonation.write")])
	.handler(async () => {
		return db
			.select({
				id: client.id,
				name: client.name,
				image: client.image,
				domains: client.domains,
			})
			.from(client)
			.orderBy(asc(client.name));
	});

export const getSuperAdminClientUsers = createServerFn({ method: "POST" })
	.middleware([authMiddleware, requirePermission("impersonation.write")])
	.inputValidator((data: { clientId: string }) => data)
	.handler(async ({ data }) => {
		const clientId = data.clientId.trim();
		if (!clientId) {
			throw createUserFacingError("Please select a client.");
		}

		const [workspaceClient] = await db
			.select({
				id: client.id,
			})
			.from(client)
			.where(eq(client.id, clientId))
			.limit(1);

		if (!workspaceClient) {
			throw createUserFacingError("Client not found.");
		}

		return db
			.select({
				id: user.id,
				name: user.name,
				email: user.email,
				image: user.image,
				role: user.role,
			})
			.from(user)
			.where(eq(user.clientId, clientId))
			.orderBy(asc(user.name));
	});

function getUtcWeekStart(date: Date) {
	const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
	const day = start.getUTCDay();
	const diffToMonday = (day + 6) % 7;
	start.setUTCDate(start.getUTCDate() - diffToMonday);
	start.setUTCHours(0, 0, 0, 0);
	return start;
}

function addUtcDays(date: Date, days: number) {
	const next = new Date(date);
	next.setUTCDate(next.getUTCDate() + days);
	return next;
}

function weekKey(date: Date) {
	return date.toISOString().slice(0, 10);
}

export const getSuperAdminClientWeeklyUsage = createServerFn({ method: "POST" })
	.middleware([authMiddleware, requirePermission("impersonation.write")])
	.inputValidator((data: { clientId: string; weeks?: number }) => data)
	.handler(async ({ data }) => {
		const clientId = data.clientId.trim();
		const requestedWeeks = data.weeks ?? 12;
		const weeks = Math.min(Math.max(Number.isFinite(requestedWeeks) ? Math.floor(requestedWeeks) : 12, 4), 52);

		if (!clientId) {
			throw createUserFacingError("Please select a client.");
		}

		const [workspaceClient] = await db
			.select({
				id: client.id,
				name: client.name,
				domains: client.domains,
			})
			.from(client)
			.where(eq(client.id, clientId))
			.limit(1);

		if (!workspaceClient) {
			throw createUserFacingError("Client not found.");
		}

		const now = new Date();
		const currentWeekStart = getUtcWeekStart(now);
		const oldestWeekStart = addUtcDays(currentWeekStart, -(weeks - 1) * 7);

		const [rotationCountRows, rotationPeopleRows, statusPageCountRows, incidentRows, statusUpdateRows] = await Promise.all([
			db.select({ count: count() }).from(rotation).where(eq(rotation.clientId, clientId)),
			db
				.select({
					count: sql<number>`count(distinct ${rotationMember.assigneeId})`,
				})
				.from(rotation)
				.leftJoin(rotationMember, eq(rotation.id, rotationMember.rotationId))
				.where(eq(rotation.clientId, clientId)),
			db.select({ count: count() }).from(statusPage).where(eq(statusPage.clientId, clientId)),
			db.execute<{ week_start: Date | string; count: number }>(sql`
				select
					date_trunc('week', ${incidentAnalysis.createdAt}) as week_start,
					count(*)::int as count
				from ${incidentAnalysis}
				where ${incidentAnalysis.clientId} = ${clientId}
				  and ${incidentAnalysis.createdAt} >= ${oldestWeekStart}
				group by 1
				order by 1 asc
			`),
			db.execute<{ week_start: Date | string; count: number }>(sql`
				select
					date_trunc('week', ${incidentAffectionUpdate.createdAt}) as week_start,
					count(*)::int as count
				from ${incidentAffectionUpdate}
				where ${incidentAffectionUpdate.createdAt} >= ${oldestWeekStart}
				  and exists (
					select 1
					from ${incidentAffectionService}
					inner join ${statusPageService} on ${statusPageService.serviceId} = ${incidentAffectionService.serviceId}
					inner join ${statusPage} on ${statusPage.id} = ${statusPageService.statusPageId}
					where ${incidentAffectionService.affectionId} = ${incidentAffectionUpdate.affectionId}
					  and ${statusPage.clientId} = ${clientId}
				  )
				group by 1
				order by 1 asc
			`),
		]);

		const incidentCountByWeek = new Map<string, number>();
		for (const row of incidentRows.rows) {
			const weekStartDate = row.week_start instanceof Date ? row.week_start : new Date(row.week_start);
			incidentCountByWeek.set(weekKey(weekStartDate), toCountValue(row.count));
		}

		const statusPageUpdateCountByWeek = new Map<string, number>();
		for (const row of statusUpdateRows.rows) {
			const weekStartDate = row.week_start instanceof Date ? row.week_start : new Date(row.week_start);
			statusPageUpdateCountByWeek.set(weekKey(weekStartDate), toCountValue(row.count));
		}

		const timeline = Array.from({ length: weeks }, (_, index) => {
			const weekStart = addUtcDays(oldestWeekStart, index * 7);
			const weekEnd = addUtcDays(weekStart, 6);
			const key = weekKey(weekStart);
			return {
				weekStart: weekStart.toISOString(),
				weekEnd: weekEnd.toISOString(),
				incidentCount: incidentCountByWeek.get(key) ?? 0,
				statusPageUpdateCount: statusPageUpdateCountByWeek.get(key) ?? 0,
			};
		});

		return {
			client: workspaceClient,
			current: {
				rotationCount: toCountValue(rotationCountRows[0]?.count ?? 0),
				peopleInRotationCount: toCountValue(rotationPeopleRows[0]?.count ?? 0),
				statusPageCount: toCountValue(statusPageCountRows[0]?.count ?? 0),
			},
			timeline,
		};
	});
