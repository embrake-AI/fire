import type { IncidentEventData } from "@fire/db/schema";
import type { AgentExport } from "../agent/providers/types";

export type IncidentArchive = {
	version: 1;
	incidentId: string;
	archivedAt: string;
	events: IncidentEventData[];
	agents: { similarIncidents: AgentExport | null };
};

export function archiveKey(clientId: string, incidentId: string) {
	return `${clientId}/${incidentId}/archive.json`;
}
