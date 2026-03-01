import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { IS, IS_Event } from "@fire/common";
import { type IncidentEventData, incidentAction, incidentAnalysis } from "@fire/db/schema";
import { and, eq } from "drizzle-orm";
import { getSimilarIncidentsProvider } from "../agent/providers/registry";
import type { AgentExport } from "../agent/providers/types";
import { archiveKey, type IncidentArchive } from "../core/archive";
import { generateIncidentPostmortem } from "../core/idontknowhowtonamethisitswhereillplacecallstoai";
import type { Metadata } from "../handler";
import { getDB } from "../lib/db";

export type IncidentAnalysisWorkflowPayload = {
	incidentId: string;
	incident: {
		title: string;
		description: string;
		severity: IS["severity"];
		assignee: string;
		createdBy: string;
		source: IS["source"];
		prompt: string;
		entryPointId: string;
		rotationId: string | undefined;
		teamId: string | undefined;
		createdAt: string;
	};
	metadata: Metadata;
	events: IncidentEventData[];
};

function parseTimestamp(value: string | undefined) {
	if (!value) return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

function isTerminalIncidentStatus(status: string | undefined): status is Extract<IS["status"], "resolved" | "declined"> {
	return status === "resolved" || status === "declined";
}

function getTerminalStatusEvent(
	events: IncidentEventData[],
): (IncidentEventData & { event_type: "STATUS_UPDATE"; event_data: Extract<IS_Event, { event_type: "STATUS_UPDATE" }>["event_data"] }) | undefined {
	for (const event of [...events].reverse()) {
		if (event.event_type !== "STATUS_UPDATE") {
			continue;
		}
		const status = event.event_data?.status;
		if (isTerminalIncidentStatus(status)) {
			return event;
		}
	}
	return undefined;
}

function isResolvedStatusEvent(
	event: IncidentEventData,
): event is IncidentEventData & { event_type: "STATUS_UPDATE"; event_data: Extract<IS_Event, { event_type: "STATUS_UPDATE" }>["event_data"] } {
	return event.event_type === "STATUS_UPDATE" && event.event_data?.status === "resolved";
}

export class IncidentAnalysisWorkflow extends WorkflowEntrypoint<Env, IncidentAnalysisWorkflowPayload> {
	async run(event: WorkflowEvent<IncidentAnalysisWorkflowPayload>, step: WorkflowStep) {
		const payload = event.payload;
		const { incidentId, incident, metadata, events } = payload;
		const terminalStatusEvent = getTerminalStatusEvent(events);
		const terminalStatus = terminalStatusEvent?.event_data.status === "declined" ? "declined" : "resolved";
		const declineReasonRaw = terminalStatus === "declined" ? (terminalStatusEvent?.event_data.message.trim() ?? "") : "";
		const declineReason = declineReasonRaw.length ? declineReasonRaw : null;
		const shouldGeneratePostmortem = terminalStatus !== "declined";

		// Step 1: Extract agent data before cleanup
		const agentData = await step.do(`extract-agent-data:${incidentId}`, async (): Promise<AgentExport | null> => {
			try {
				const provider = getSimilarIncidentsProvider(this.env, incidentId);
				const data = await provider.exportData();
				return { provider: data.provider, incidentId: data.incidentId, steps: data.steps, contexts: data.contexts };
			} catch (error) {
				console.error("Failed to extract agent data", error);
				return null;
			}
		});

		// Step 2: Upload archive to R2
		await step.do(`upload-archive:${incidentId}`, async () => {
			const archive: IncidentArchive = {
				version: 1,
				incidentId,
				archivedAt: new Date().toISOString(),
				events,
				agents: { similarIncidents: agentData },
			};
			const key = archiveKey(metadata.clientId, incidentId);
			await this.env.INCIDENT_ARCHIVE.put(key, JSON.stringify(archive), {
				httpMetadata: { contentType: "application/json" },
			});
		});

		// Step 3: Generate postmortem (with agent data)
		const postmortem = shouldGeneratePostmortem
			? await step.do(`generate-postmortem:${incidentId}`, { retries: { limit: 5, delay: "30 seconds", backoff: "exponential" } }, async () =>
					generateIncidentPostmortem(
						{
							title: incident.title,
							description: incident.description,
							severity: incident.severity,
							prompt: incident.prompt,
							createdAt: parseTimestamp(incident.createdAt) ?? new Date(),
						},
						events.map((eventItem) => ({
							event_type: eventItem.event_type,
							event_data: eventItem.event_data,
							created_at: eventItem.created_at,
						})),
						this.env.OPENAI_API_KEY,
						agentData,
					),
				)
			: null;

		// Step 4: Persist analysis to PG (unchanged)
		await step.do(`persist-analysis:${incidentId}`, { retries: { limit: 5, delay: "1 minute", backoff: "exponential" } }, async () => {
			const db = getDB(this.env.db);
			const [existing] = await db
				.select({ id: incidentAnalysis.id })
				.from(incidentAnalysis)
				.where(and(eq(incidentAnalysis.id, incidentId), eq(incidentAnalysis.clientId, metadata.clientId)));

			if (existing) {
				return { status: "exists" };
			}

			const timeline = postmortem ? postmortem.timeline.filter((item) => item?.text?.trim().length) : [];
			const rootCause = postmortem?.rootCause.trim() ?? "";
			const impact = postmortem?.impact.trim() ?? "";
			const actions = postmortem ? postmortem.actions.map((action) => action.trim()).filter((action) => action.length) : [];

			const createdAt = parseTimestamp(incident.createdAt) ?? parseTimestamp(events[0]?.created_at) ?? new Date();
			const resolvedAtFromEvents = terminalStatusEvent ?? (shouldGeneratePostmortem ? [...events].reverse().find(isResolvedStatusEvent) : undefined);
			const resolvedAtValue = parseTimestamp(resolvedAtFromEvents?.created_at) ?? new Date();

			await db.transaction(async (tx) => {
				await tx.insert(incidentAnalysis).values({
					id: incidentId,
					clientId: metadata.clientId,
					title: incident.title,
					description: incident.description,
					severity: incident.severity,
					assignee: incident.assignee,
					createdBy: incident.createdBy,
					source: incident.source,
					prompt: incident.prompt,
					timeline: timeline.length ? timeline : undefined,
					rootCause: rootCause.length ? rootCause : undefined,
					impact: impact.length ? impact : undefined,
					events,
					terminalStatus,
					declineReason,
					createdAt,
					resolvedAt: resolvedAtValue,
					entryPointId: incident.entryPointId || undefined,
					rotationId: incident.rotationId ?? undefined,
					teamId: incident.teamId ?? undefined,
				});

				if (actions.length) {
					await tx.insert(incidentAction).values(
						actions.map((description) => ({
							incidentId,
							description,
						})),
					);
				}
			});

			return { status: "inserted" };
		});

		// Step 5: Cleanup agent DOs
		await step.do(`cleanup-agents:${incidentId}`, async () => {
			try {
				const provider = getSimilarIncidentsProvider(this.env, incidentId);
				await provider.cleanup();
			} catch (error) {
				console.error("Failed to cleanup agent DO", error);
			}
		});
	}
}
