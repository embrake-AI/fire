import { incidentAction, incidentAnalysis } from "@fire/db/schema";
import { createServerFn } from "@tanstack/solid-start";
import { and, eq, exists } from "drizzle-orm";
import { authMiddleware } from "../auth/auth-middleware";
import { db } from "../db";

export const updateAnalysisImpact = createServerFn({ method: "POST" })
	.inputValidator((data: { id: string; impact: string }) => data)
	.middleware([authMiddleware])
	.handler(async ({ data, context }) => {
		const [updated] = await db
			.update(incidentAnalysis)
			.set({ impact: data.impact.trim() || null })
			.where(and(eq(incidentAnalysis.id, data.id), eq(incidentAnalysis.clientId, context.clientId)))
			.returning({ id: incidentAnalysis.id });
		if (!updated) throw new Error("Analysis not found");
		return updated;
	});

export const updateAnalysisRootCause = createServerFn({ method: "POST" })
	.inputValidator((data: { id: string; rootCause: string }) => data)
	.middleware([authMiddleware])
	.handler(async ({ data, context }) => {
		const [updated] = await db
			.update(incidentAnalysis)
			.set({ rootCause: data.rootCause.trim() || null })
			.where(and(eq(incidentAnalysis.id, data.id), eq(incidentAnalysis.clientId, context.clientId)))
			.returning({ id: incidentAnalysis.id });
		if (!updated) throw new Error("Analysis not found");
		return updated;
	});

export const updateAnalysisTimeline = createServerFn({ method: "POST" })
	.inputValidator((data: { id: string; timeline: { created_at: string; text: string }[] }) => data)
	.middleware([authMiddleware])
	.handler(async ({ data, context }) => {
		const filtered = data.timeline.filter((item) => item.text.trim().length > 0).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
		const [updated] = await db
			.update(incidentAnalysis)
			.set({ timeline: filtered.length ? filtered : null })
			.where(and(eq(incidentAnalysis.id, data.id), eq(incidentAnalysis.clientId, context.clientId)))
			.returning({ id: incidentAnalysis.id });
		if (!updated) throw new Error("Analysis not found");
		return updated;
	});

export const updateIncidentAction = createServerFn({ method: "POST" })
	.inputValidator((data: { id: string; description: string }) => data)
	.middleware([authMiddleware])
	.handler(async ({ data, context }) => {
		const ownsAction = exists(
			db
				.select()
				.from(incidentAnalysis)
				.where(and(eq(incidentAnalysis.id, incidentAction.incidentId), eq(incidentAnalysis.clientId, context.clientId))),
		);
		const [updated] = await db
			.update(incidentAction)
			.set({ description: data.description.trim() })
			.where(and(eq(incidentAction.id, data.id), ownsAction))
			.returning({ id: incidentAction.id, incidentId: incidentAction.incidentId });
		if (!updated) throw new Error("Action not found");
		return updated;
	});

export const deleteIncidentAction = createServerFn({ method: "POST" })
	.inputValidator((data: { id: string }) => data)
	.middleware([authMiddleware])
	.handler(async ({ data, context }) => {
		const ownsAction = exists(
			db
				.select()
				.from(incidentAnalysis)
				.where(and(eq(incidentAnalysis.id, incidentAction.incidentId), eq(incidentAnalysis.clientId, context.clientId))),
		);
		const [deleted] = await db
			.delete(incidentAction)
			.where(and(eq(incidentAction.id, data.id), ownsAction))
			.returning({ id: incidentAction.id });
		if (!deleted) throw new Error("Action not found");
		return deleted;
	});

export const createIncidentAction = createServerFn({ method: "POST" })
	.inputValidator((data: { incidentId: string; description: string }) => data)
	.middleware([authMiddleware])
	.handler(async ({ data, context }) => {
		const [analysis] = await db
			.select({ id: incidentAnalysis.id })
			.from(incidentAnalysis)
			.where(and(eq(incidentAnalysis.id, data.incidentId), eq(incidentAnalysis.clientId, context.clientId)));
		if (!analysis) throw new Error("Incident not found");
		const [created] = await db
			.insert(incidentAction)
			.values({ incidentId: data.incidentId, description: data.description.trim() })
			.returning({ id: incidentAction.id, description: incidentAction.description });
		return created;
	});
