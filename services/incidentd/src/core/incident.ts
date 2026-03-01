import { DurableObject } from "cloudflare:workers";
import type { EntryPoint, EventLog, IS, IS_Event } from "@fire/common";
import type { IncidentEventData } from "@fire/db/schema";
import type { AgentAffectionInfo, AgentEvent, AgentIncidentSnapshot, AgentService, AgentTurnPayload } from "../agent/types";
import type { IncidentAnalysisWorkflowPayload } from "../dispatcher/analysis-workflow";
import { INCIDENT_WORKFLOW_EVENT_TYPE, type IncidentWorkflowPayload } from "../dispatcher/workflow";
import type { Metadata } from "../handler";
import { calculateIncidentInfo } from "./idontknowhowtonamethisitswhereillplacecallstoai";
import { type AffectionImpact, type AffectionStatus, filterAffectionServices, normalizeAffectionStatus, validateAffectionUpdate } from "./incident/affection";
import { type AgentState, computeAgentNextAt, decideAlarmAction, shouldStartAgentTurn } from "./incident/alarm";
import { mapAgentEventRow, mapAnalysisEventRow } from "./incident/event-log";
import { createWorkflowIfMissing } from "./incident/workflow";

export type DOState = IS & {
	metadata: Metadata;
	_initialized: boolean;
};

const STATE_KEY = "S";
const EVENTLOGVERSION_KEY = "ELV";
const ENTRYPOINT_KEY = "EP";
const SERVICES_KEY = "SV";
const BOOTSTRAP_MESSAGES_KEY = "BM";
const AGENT_STATE_KEY = "AG";
const ALARM_INTERVAL_MS = 200;
const MAX_ATTEMPTS = 3;

type AffectionUpdateData = Extract<IS_Event, { event_type: "AFFECTION_UPDATE" }>["event_data"];
type SimilarIncidentsDiscoveredData = Extract<IS_Event, { event_type: "SIMILAR_INCIDENTS_DISCOVERED" }>["event_data"];
type SimilarIncidentData = Extract<IS_Event, { event_type: "SIMILAR_INCIDENT" }>["event_data"];
type ContextAgentTriggeredData = Extract<IS_Event, { event_type: "CONTEXT_AGENT_TRIGGERED" }>["event_data"];
type AgentContextEventPayload =
	| {
			eventType: "SIMILAR_INCIDENTS_DISCOVERED";
			eventData: SimilarIncidentsDiscoveredData;
			dedupeKey: string;
	  }
	| {
			eventType: "CONTEXT_AGENT_TRIGGERED";
			eventData: ContextAgentTriggeredData;
			dedupeKey: string;
	  };
type AgentInsightEventPayload = {
	eventType: "SIMILAR_INCIDENT";
	eventData: SimilarIncidentData;
	dedupeKey: string;
};
type IncidentService = { id: string; name: string; prompt: string | null };
type SuggestionLogInput = { message: string; suggestionId: string; messageId: string; suggestion?: Record<string, unknown> };
type BootstrapMessage = { message: string; userId: string; messageId: string; createdAt: string };

function isTerminalIncidentStatus(status: IS["status"]) {
	return status === "resolved" || status === "declined";
}

function normalizeIncidentServices(services: IncidentService[]) {
	const serviceMap = new Map<string, IncidentService>();
	for (const service of services) {
		if (!service?.id || !service?.name) continue;
		if (!serviceMap.has(service.id)) {
			serviceMap.set(service.id, { id: service.id, name: service.name, prompt: service.prompt ?? null });
		}
	}
	return Array.from(serviceMap.values());
}

function formatSqliteTimestampUtc(date: Date): string {
	const year = date.getUTCFullYear();
	const month = String(date.getUTCMonth() + 1).padStart(2, "0");
	const day = String(date.getUTCDate()).padStart(2, "0");
	const hours = String(date.getUTCHours()).padStart(2, "0");
	const minutes = String(date.getUTCMinutes()).padStart(2, "0");
	const seconds = String(date.getUTCSeconds()).padStart(2, "0");
	const milliseconds = String(date.getUTCMilliseconds()).padStart(3, "0");
	return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}`;
}

function normalizeBootstrapMessages(messages: BootstrapMessage[]) {
	const normalized = messages
		.filter((message) => message?.messageId && message?.createdAt)
		.map((message) => {
			const parsed = new Date(message.createdAt);
			if (Number.isNaN(parsed.getTime())) {
				return null;
			}
			return {
				message: message.message ?? "",
				userId: message.userId || "unknown",
				messageId: message.messageId,
				createdAt: formatSqliteTimestampUtc(parsed),
			} satisfies BootstrapMessage;
		})
		.filter((message): message is BootstrapMessage => !!message)
		.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

	const deduped: BootstrapMessage[] = [];
	const seen = new Set<string>();
	for (const message of normalized) {
		if (seen.has(message.messageId)) {
			continue;
		}
		seen.add(message.messageId);
		deduped.push(message);
	}
	return deduped;
}

/**
 * An Incident is the source of truth for an incident. It is agnostic of the communication channel(s).
 * All operations guarantee transactional consistency: https://blog.cloudflare.com/durable-objects-easy-fast-correct-choose-three/
 *
 * Pointers to understand this code:
 * - Any storage operations performed directly on the `ctx.storage` object, will be considered part of the transaction: https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#transaction
 * - Alarms have guaranteed at-least-once execution and are retried automatically when the alarm() handler throws: https://developers.cloudflare.com/durable-objects/api/alarms/
 *
 * Invariants:
 * - An update is accepted iff the state is commited: `state` snapshot + `event` row
 * - A state update is (transactionally) committed iff an alarm is scheduled
 * - An Incident exists iff `start` is called. Otherwise, it rejects all other calls.
 * - An event is forwarded to the workflow only when all previous events have been published or failed MAX_ATTEMPTS times.
 *
 * Acknowledge callers on state persistence, not on side effects:
 * - All side effects are executed in the workflow (alarm only forwards events to it).
 *
 * Retrieve from ctx.storage, not from local state:
 * - Both would work, but retrieving from storage is as efficient since cloudflare will cache the result.
 * - Easier to code (no need to check if in local state or refetch)
 */
export class Incident extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.ctx.blockConcurrencyWhile(() => this.migrate());
	}

	private async migrate() {
		// No migrations yet
	}

	private getState() {
		const state = this.ctx.storage.kv.get<DOState>(STATE_KEY);
		if (!state) {
			return { error: "NOT_FOUND" };
		} else if (!state._initialized) {
			return { error: "NOT_INITIALIZED" };
		} else if (isTerminalIncidentStatus(state.status)) {
			return { error: "RESOLVED" };
		}
		return state;
	}

	private async scheduleAlarmAtMost(time: number) {
		const existingAlarm = await this.ctx.storage.getAlarm();
		if (existingAlarm && existingAlarm <= time) {
			return;
		}
		await this.ctx.storage.setAlarm(time);
	}

	private getAgentState(): AgentState {
		return this.ctx.storage.kv.get<AgentState>(AGENT_STATE_KEY) ?? { lastProcessedEventId: 0, toEventId: null };
	}

	private setAgentState(state: AgentState) {
		this.ctx.storage.kv.put(AGENT_STATE_KEY, state);
	}

	private listAgentEvents({ toId }: { toId?: number } = {}): AgentEvent[] {
		const rows =
			typeof toId === "number"
				? this.ctx.storage.sql
						.exec<Pick<EventLog, "id" | "event_type" | "event_data" | "created_at" | "adapter" | "event_metadata">>(
							"SELECT id, event_type, event_data, created_at, adapter, event_metadata FROM event_log WHERE id <= ? ORDER BY id ASC",
							toId,
						)
						.toArray()
				: this.ctx.storage.sql
						.exec<Pick<EventLog, "id" | "event_type" | "event_data" | "created_at" | "adapter" | "event_metadata">>(
							"SELECT id, event_type, event_data, created_at, adapter, event_metadata FROM event_log ORDER BY id ASC",
						)
						.toArray();

		return rows.map(mapAgentEventRow);
	}

	private buildAgentIncidentSnapshot(state: DOState): AgentIncidentSnapshot {
		return {
			id: state.id,
			status: state.status,
			severity: state.severity,
			title: state.title,
			description: state.description,
			prompt: state.prompt,
			assignee: state.assignee.slackId,
			source: state.source,
			createdAt: state.createdAt instanceof Date ? state.createdAt.toISOString() : new Date(state.createdAt).toISOString(),
		};
	}

	private getAgentServicesFromStorage(): AgentService[] {
		return (this.ctx.storage.kv.get<AgentService[]>(SERVICES_KEY) ?? []).map((service) => ({
			id: service.id,
			name: service.name,
			prompt: service.prompt ?? null,
		}));
	}

	private buildAgentTurnPayload(params: { state: DOState; fromEventId: number; toEventId: number; events: AgentEvent[]; affection: AgentAffectionInfo; services: AgentService[] }) {
		const { state, fromEventId, toEventId, events, affection, services } = params;
		const turnId = `${toEventId}`;
		return {
			incidentId: state.id,
			turnId,
			fromEventId,
			toEventId,
			incident: this.buildAgentIncidentSnapshot(state),
			metadata: state.metadata,
			services,
			affection,
			events,
		} satisfies AgentTurnPayload;
	}

	private getAffectionInfoFromLog(): AgentAffectionInfo {
		const [row] = this.ctx.storage.sql
			.exec<{ last_update_at: string | null; last_status: string | null }>(
				`
				SELECT
					(SELECT created_at FROM event_log WHERE event_type = 'AFFECTION_UPDATE' ORDER BY id DESC LIMIT 1) AS last_update_at,
					(
						SELECT json_extract(event_data, '$.status')
						FROM event_log
						WHERE event_type = 'AFFECTION_UPDATE' AND json_extract(event_data, '$.status') IS NOT NULL
						ORDER BY id DESC
						LIMIT 1
					) AS last_status
				`,
			)
			.toArray();

		if (!row?.last_update_at) {
			return { hasAffection: false };
		}

		const lastStatus = row.last_status === "investigating" || row.last_status === "mitigating" || row.last_status === "resolved" ? row.last_status : undefined;

		return {
			hasAffection: true,
			lastStatus,
			lastUpdateAt: row.last_update_at,
		};
	}

	private async startAgentTurnWorkflow(payload: AgentTurnPayload) {
		const workflowId = `agent-turn-${payload.incidentId}-${payload.turnId}`;
		await createWorkflowIfMissing(() => this.env.INCIDENT_AGENT_WORKFLOW.create({ id: workflowId, params: payload }));
	}

	private buildWorkflowPayload(event: EventLog, state: DOState): IncidentWorkflowPayload {
		return {
			kind: "event",
			event: {
				event_type: event.event_type,
				event_data: JSON.parse(event.event_data),
				event_id: event.id,
				incident_id: state.id,
			},
			incident: {
				status: state.status,
				assignee: state.assignee.slackId,
				severity: state.severity,
				title: state.title,
				description: state.description,
			},
			metadata: state.metadata,
			adapter: event.adapter,
			eventMetadata: event.event_metadata ? JSON.parse(event.event_metadata) : undefined,
		};
	}

	private async startAnalysisWorkflow() {
		const state = this.ctx.storage.kv.get<DOState>(STATE_KEY)!;
		const eventsForStorage = this.ctx.storage.sql
			.exec<Pick<EventLog, "id" | "event_type" | "event_data" | "adapter" | "created_at">>("SELECT id, event_type, event_data, adapter, created_at FROM event_log ORDER BY id ASC")
			.toArray()
			.map(mapAnalysisEventRow) as IncidentEventData[];

		const createdAt = state.createdAt instanceof Date ? state.createdAt.toISOString() : new Date(state.createdAt).toISOString();

		const payload: IncidentAnalysisWorkflowPayload = {
			incidentId: state.id,
			metadata: state.metadata,
			incident: {
				title: state.title,
				description: state.description,
				severity: state.severity,
				assignee: state.assignee.slackId,
				createdBy: state.createdBy,
				source: state.source,
				prompt: state.prompt,
				entryPointId: state.entryPointId,
				rotationId: state.rotationId,
				teamId: state.teamId,
				createdAt,
			},
			events: eventsForStorage,
		};

		const workflowId = `analysis-${state.id}`;
		await createWorkflowIfMissing(() => this.env.INCIDENT_ANALYSIS_WORKFLOW.create({ id: workflowId, params: payload }));
	}

	private async dispatchToWorkflow(event: EventLog, state: DOState) {
		const payload = this.buildWorkflowPayload(event, state);
		const workflowId = state.id;
		if (event.event_type === "INCIDENT_CREATED") {
			await createWorkflowIfMissing(() => this.env.INCIDENT_WORKFLOW.create({ id: workflowId, params: payload }));
		} else {
			const instance = await this.env.INCIDENT_WORKFLOW.get(workflowId);
			await instance.sendEvent({ type: INCIDENT_WORKFLOW_EVENT_TYPE, payload });
		}
	}

	private async ensureInitializedState(): Promise<DOState | null> {
		let state = this.ctx.storage.kv.get<DOState>(STATE_KEY);
		if (!state) {
			return null;
		}
		if (!state._initialized) {
			const uninitializedState = state;
			await this.ctx.blockConcurrencyWhile(async () =>
				this.init({
					id: uninitializedState.id,
					prompt: uninitializedState.prompt,
					createdBy: uninitializedState.createdBy,
					source: uninitializedState.source,
					metadata: uninitializedState.metadata,
				}),
			);
			state = this.ctx.storage.kv.get<DOState>(STATE_KEY)!;
		}
		return state;
	}

	private async forwardEvents(state: DOState, events: EventLog[]) {
		for (const event of events) {
			try {
				await this.dispatchToWorkflow(event, state);
				this.ctx.storage.sql.exec("UPDATE event_log SET published_at = CURRENT_TIMESTAMP WHERE id = ? AND published_at IS NULL", event.id);
			} catch (error) {
				const attempts = event.attempts + 1;
				if (attempts >= MAX_ATTEMPTS) {
					console.error("Event failed after MAX_ATTEMPTS attempts, giving up", MAX_ATTEMPTS, event, error);
				} else {
					console.warn("Error forwarding event to workflow", event, error);
				}
				this.ctx.storage.sql.exec("UPDATE event_log SET attempts = ? WHERE id = ?", attempts, event.id);
				throw error;
			}
		}
	}

	private refreshAgentDebounceState(events: EventLog[], now: number) {
		const agentState = this.getAgentState();
		const lastEventId = events.at(-1)?.id ?? null;
		if (lastEventId === null) {
			return agentState;
		}

		agentState.toEventId = lastEventId;
		agentState.nextAt = computeAgentNextAt(agentState, now);
		this.setAgentState(agentState);
		return agentState;
	}

	private async maybeStartAgentTurn(state: DOState, agentState: AgentState, now: number) {
		const toEventId = agentState.toEventId;
		if (!toEventId || !shouldStartAgentTurn(agentState, now)) {
			return agentState;
		}

		try {
			const fromEventId = agentState.lastProcessedEventId;
			const events = this.listAgentEvents({ toId: toEventId });
			const services = this.getAgentServicesFromStorage();
			const affection = this.getAffectionInfoFromLog();
			if (events.length) {
				const payload = this.buildAgentTurnPayload({
					state,
					fromEventId,
					toEventId,
					events,
					affection,
					services,
				});
				await this.startAgentTurnWorkflow(payload);
			}
			const nextAgentState = {
				lastProcessedEventId: toEventId,
				toEventId,
				nextAt: undefined,
			} as const;
			this.setAgentState(nextAgentState);
			return nextAgentState;
		} catch (error) {
			console.error("Failed to start agent turn workflow", error);
			await this.scheduleAlarmAtMost(Date.now() + ALARM_INTERVAL_MS);
			return agentState;
		}
	}

	private async scheduleNextAlarmOrCleanup(state: DOState, agentState: AgentState) {
		const hasForwardableUnpublishedEvents =
			this.ctx.storage.sql.exec<{ id: number }>("SELECT id FROM event_log WHERE published_at IS NULL AND attempts < ? LIMIT 1", MAX_ATTEMPTS).toArray().length > 0;
		const action = decideAlarmAction({
			now: Date.now() + ALARM_INTERVAL_MS,
			hasForwardableUnpublishedEvents,
			agentState,
			status: state.status,
		});

		switch (action.type) {
			case "retry-events":
			case "run-agent":
				await this.scheduleAlarmAtMost(action.at);
				return;
			case "cleanup":
				await this.destroy();
				return;
			case "none":
				return;
		}
	}

	/**
	 * Either succeeds and there is no unpublished event
	 * or fails throwing an error (and retries)
	 */
	async alarm() {
		const state = await this.ensureInitializedState();
		if (!state) {
			return;
		}

		const events = this.ctx.storage.sql.exec<EventLog>("SELECT * FROM event_log WHERE published_at IS NULL AND attempts < ? ORDER BY id ASC LIMIT 100", MAX_ATTEMPTS).toArray();
		await this.forwardEvents(state, events);
		const now = Date.now();
		let agentState = this.refreshAgentDebounceState(events, now);
		agentState = await this.maybeStartAgentTurn(state, agentState, now);
		await this.scheduleNextAlarmOrCleanup(state, agentState);
	}

	/**
	 * Initialize the incident. ALWAYS check if it's already initialized before calling this.
	 */
	private async init({ id, prompt, createdBy, source, metadata }: Pick<DOState, "id" | "prompt" | "createdBy" | "source" | "metadata">) {
		const entryPoints = this.ctx.storage.kv.get<EntryPoint[]>(ENTRYPOINT_KEY);
		if (!entryPoints?.length) {
			throw new Error("No entry points found");
		}
		const bootstrapMessages = this.ctx.storage.kv.get<BootstrapMessage[]>(BOOTSTRAP_MESSAGES_KEY) ?? [];
		const { selectedEntryPoint, severity, title, description } = await calculateIncidentInfo(prompt, entryPoints, this.env.OPENAI_API_KEY);
		const assignee = selectedEntryPoint.assignee;
		const entryPointId = selectedEntryPoint.id;
		const rotationId = selectedEntryPoint.rotationId;
		const teamId = selectedEntryPoint.teamId;

		const status = "open";
		const payload = {
			id,
			createdAt: new Date(),
			status,
			severity,
			createdBy,
			assignee,
			title,
			description,
			prompt,
			source,
			entryPointId,
			rotationId,
			teamId,
			metadata,
			_initialized: true,
		} as const;
		await this.ctx.storage.transaction(async () => {
			this.ctx.storage.sql.exec(`CREATE TABLE event_log (
				id INTEGER PRIMARY KEY,
				event_type TEXT NOT NULL,
				event_data TEXT NOT NULL CHECK (json_valid(event_data)) NOT NULL,
				event_metadata TEXT DEFAULT NULL CHECK (event_metadata IS NULL OR json_valid(event_metadata)),
				created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
				published_at TEXT DEFAULT NULL,
				attempts INTEGER NOT NULL DEFAULT 0,
				adapter TEXT NOT NULL
			);
			CREATE INDEX idx_event_log_published_at ON event_log(published_at);
			CREATE INDEX idx_event_log_type_id ON event_log(event_type, id);
			CREATE INDEX idx_event_log_message_id ON event_log(event_type, json_extract(event_data, '$.messageId'));
			CREATE INDEX idx_event_log_agent_dedupe ON event_log(event_type, json_extract(event_metadata, '$.agentDedupeKey'));
			`);
			this.ctx.storage.kv.put(EVENTLOGVERSION_KEY, "1");
			for (const message of bootstrapMessages) {
				this.ctx.storage.sql.exec(
					"INSERT INTO event_log (event_type, event_data, created_at, published_at, adapter) VALUES ('MESSAGE_ADDED', ?, ?, ?, 'slack')",
					JSON.stringify({ message: message.message, userId: message.userId, messageId: message.messageId }),
					message.createdAt,
					message.createdAt,
				);
			}
			await this.commit(
				{
					state: payload,
					event: {
						event_type: "INCIDENT_CREATED",
						event_data: { assignee: assignee.slackId, createdBy, description, prompt, severity, source, status, title, entryPointId, rotationId },
					},
					adapter: source,
				},
				{ skipAlarm: true },
			);
			this.ctx.storage.kv.delete(ENTRYPOINT_KEY);
			this.ctx.storage.kv.delete(BOOTSTRAP_MESSAGES_KEY);
		});
		return payload;
	}

	/**
	 * Assumes `state` is already committed to the DO.
	 * Outbox pattern
	 * Atomically: commits the new state to the DO, enqueues an event to the event log and schedules an alarm to ensure eventual consistency.
	 */
	private async commit(
		{ state, event, adapter, eventMetadata }: { state: DOState; event?: IS_Event; adapter?: "slack" | "dashboard" | "fire"; eventMetadata?: Record<string, string> },
		{ skipAlarm = false }: { skipAlarm?: boolean } = {},
	) {
		await this.ctx.storage.transaction(async () => {
			this.ctx.storage.kv.put<DOState>(STATE_KEY, state);
			if (event) {
				this.ctx.storage.sql.exec(
					"INSERT INTO event_log (event_type, event_data, event_metadata, adapter) VALUES (?, ?, ?, ?)",
					event.event_type,
					JSON.stringify(event.event_data),
					eventMetadata ? JSON.stringify(eventMetadata) : null,
					adapter,
				);
				if (!skipAlarm) {
					await this.scheduleAlarmAtMost(Date.now());
				}
			}
		});
	}

	private async destroy() {
		await this.startAnalysisWorkflow();
		await Promise.all([this.ctx.storage.deleteAlarm(), this.ctx.storage.deleteAll()]);
	}

	/**
	 * Entry point to start a new incident. Must be called before any other method.
	 */
	async start(
		{ id, prompt, createdBy, source, metadata }: Pick<DOState, "id" | "prompt" | "createdBy" | "source" | "metadata">,
		entryPoints: EntryPoint[],
		services: IncidentService[],
		bootstrapMessages: BootstrapMessage[] = [],
	) {
		const state = this.ctx.storage.kv.get<DOState>(STATE_KEY);
		if (!state) {
			if (!entryPoints.length) {
				throw new Error("At least one entry point is required");
			}

			await this.ctx.storage.transaction(async () => {
				const normalizedServices = normalizeIncidentServices(services);
				const normalizedBootstrapMessages = normalizeBootstrapMessages(bootstrapMessages);
				this.ctx.storage.kv.put<DOState>(STATE_KEY, {
					id,
					prompt,
					createdBy,
					source,
					metadata,
					createdAt: new Date(),
					status: "open",
					// This will be set on `init`
					severity: "medium",
					assignee: { slackId: "" },
					title: "",
					description: "",
					entryPointId: "",
					_initialized: false,
					rotationId: undefined,
					teamId: undefined,
					// This will be set on `init`
				});
				this.ctx.storage.kv.put(ENTRYPOINT_KEY, entryPoints);
				this.ctx.storage.kv.put(SERVICES_KEY, normalizedServices);
				if (normalizedBootstrapMessages.length) {
					this.ctx.storage.kv.put(BOOTSTRAP_MESSAGES_KEY, normalizedBootstrapMessages);
				} else {
					this.ctx.storage.kv.delete(BOOTSTRAP_MESSAGES_KEY);
				}
				await this.ctx.storage.setAlarm(Date.now());
			});
		}
	}

	async setSeverity(severity: DOState["severity"], adapter: "slack" | "dashboard" | "fire", eventMetadata?: Record<string, string>) {
		const state = this.getState();
		if ("error" in state) {
			return state;
		}
		if (state.severity !== severity) {
			state.severity = severity;
			await this.commit({ state, event: { event_type: "SEVERITY_UPDATE", event_data: { severity } }, adapter, eventMetadata });
		}
	}

	async setAssignee(assignee: DOState["assignee"], adapter: "slack" | "dashboard" | "fire") {
		const state = this.getState();
		if ("error" in state) {
			return state;
		}
		if (state.assignee.slackId !== assignee.slackId) {
			state.assignee = assignee;
			await this.commit({ state, event: { event_type: "ASSIGNEE_UPDATE", event_data: { assignee } }, adapter });
		}
	}

	async updateStatus(status: DOState["status"], message: string, adapter: "slack" | "dashboard" | "fire", eventMetadata?: Record<string, string>) {
		const state = this.getState();
		if ("error" in state) {
			return state;
		}
		const currentStatus = state.status;

		const invalidTransition = isTerminalIncidentStatus(currentStatus) || (currentStatus === "mitigating" && status === "open");
		const statusChange = currentStatus !== status;
		if (invalidTransition || !statusChange) {
			return;
		}

		state.status = status;
		await this.commit({ state, event: { event_type: "STATUS_UPDATE", event_data: { status, message } }, adapter, eventMetadata });
	}

	async updateAffection({
		message,
		status,
		title,
		services,
		createdBy,
		adapter,
		eventMetadata,
	}: {
		message: string;
		status?: AffectionStatus;
		title?: string;
		services?: { id: string; impact: AffectionImpact }[];
		createdBy: string;
		adapter: "slack" | "dashboard" | "fire";
		eventMetadata?: Record<string, string>;
	}): Promise<{ error: string } | undefined> {
		const state = this.getState();
		if ("error" in state) {
			return state;
		}

		const trimmedMessage = message.trim();
		const normalizedStatus = normalizeAffectionStatus(status);
		const existingAffection = this.ctx.storage.sql.exec<{ id: number }>("SELECT id FROM event_log WHERE event_type = 'AFFECTION_UPDATE' LIMIT 1").toArray();
		const hasAffection = existingAffection.length > 0;

		const trimmedTitle = title?.trim() ?? "";
		const hasTitle = trimmedTitle.length > 0;
		const allowedServices = this.ctx.storage.kv.get<IncidentService[]>(SERVICES_KEY) ?? [];
		const filteredServices = filterAffectionServices(services, new Set(allowedServices.map((service) => service.id)));
		const hasServices = filteredServices.length > 0;

		const [lastStatusRow] =
			normalizedStatus && hasAffection
				? this.ctx.storage.sql
						.exec<{ status: AffectionStatus | null }>(
							"SELECT json_extract(event_data, '$.status') AS status FROM event_log WHERE event_type = 'AFFECTION_UPDATE' AND json_extract(event_data, '$.status') IS NOT NULL ORDER BY id DESC LIMIT 1",
						)
						.toArray()
				: [];

		const validationError = validateAffectionUpdate({
			trimmedMessage,
			hasAffection,
			hasTitle,
			hasServices,
			normalizedStatus,
			currentStatus: lastStatusRow?.status,
		});
		if (validationError) {
			return validationError;
		}

		const eventData: AffectionUpdateData = {
			message: trimmedMessage,
			createdBy,
			...(normalizedStatus ? { status: normalizedStatus } : {}),
			...(hasTitle ? { title: trimmedTitle } : {}),
			...(hasServices ? { services: filteredServices } : {}),
		};

		await this.commit({ state, event: { event_type: "AFFECTION_UPDATE", event_data: eventData }, adapter, eventMetadata });
	}

	async getAgentContext() {
		const state = this.ctx.storage.kv.get<DOState>(STATE_KEY);
		if (!state) {
			return { error: "NOT_FOUND" };
		} else if (!state._initialized) {
			return { error: "INITIALIZING" };
		}

		const events = this.listAgentEvents();
		const services = this.getAgentServicesFromStorage();

		return {
			incident: this.buildAgentIncidentSnapshot(state),
			metadata: state.metadata,
			services,
			affection: this.getAffectionInfoFromLog(),
			events,
		};
	}

	async addMessage(message: string, userId: string, messageId: string, adapter: "slack" | "dashboard" | "fire", slackUserToken?: string, eventMetadata?: Record<string, string>) {
		const state = this.getState();
		if ("error" in state) {
			return state;
		}
		const existingMessage = this.ctx.storage.sql
			.exec<{ id: number }>("SELECT id FROM event_log WHERE event_type = 'MESSAGE_ADDED' AND json_extract(event_data, '$.messageId') = ? LIMIT 1", messageId)
			.toArray();
		if (existingMessage.length) {
			return;
		}
		await this.commit({
			state,
			event: { event_type: "MESSAGE_ADDED", event_data: { message, userId, messageId } },
			adapter,
			eventMetadata: { adapter, ...(slackUserToken ? { slackUserToken } : {}), ...(eventMetadata ?? {}) },
		});
	}

	async addSuggestions(suggestions: SuggestionLogInput[]) {
		const state = this.getState();
		if ("error" in state) {
			return state;
		}
		if (!suggestions.length) {
			return;
		}

		await this.ctx.storage.transaction(async () => {
			const seenMessageIds = new Set<string>();
			for (const suggestion of suggestions) {
				const message = suggestion.message?.trim();
				const suggestionId = suggestion.suggestionId?.trim();
				const messageId = suggestion.messageId?.trim();
				if (!message || !suggestionId || !messageId || seenMessageIds.has(messageId)) {
					continue;
				}
				seenMessageIds.add(messageId);

				const existing = this.ctx.storage.sql
					.exec<{ id: number }>("SELECT id FROM event_log WHERE event_type = 'MESSAGE_ADDED' AND json_extract(event_data, '$.messageId') = ? LIMIT 1", messageId)
					.toArray();
				if (existing.length) {
					continue;
				}

				this.ctx.storage.sql.exec(
					"INSERT INTO event_log (event_type, event_data, event_metadata, adapter, published_at) VALUES ('MESSAGE_ADDED', ?, ?, 'fire', CURRENT_TIMESTAMP)",
					JSON.stringify({ message, userId: "fire", messageId, ...(suggestion.suggestion ? { suggestion: suggestion.suggestion } : {}) }),
					JSON.stringify({ kind: "suggestion", agentSuggestionId: suggestionId }),
				);
			}
		});
	}

	async recordAgentContextEvent(params: AgentContextEventPayload) {
		const state = this.getState();
		if ("error" in state) {
			return state;
		}

		let inserted: { id: number; created_at: string } | undefined;
		await this.ctx.storage.transaction(async () => {
			const [existing] = this.ctx.storage.sql
				.exec<{ id: number; created_at: string }>(
					"SELECT id, created_at FROM event_log WHERE event_type = ? AND json_extract(event_metadata, '$.agentDedupeKey') = ? LIMIT 1",
					params.eventType,
					params.dedupeKey,
				)
				.toArray();
			if (existing) {
				inserted = existing;
				return;
			}
			this.ctx.storage.sql.exec(
				"INSERT INTO event_log (event_type, event_data, event_metadata, adapter, published_at) VALUES (?, ?, ?, 'fire', CURRENT_TIMESTAMP)",
				params.eventType,
				JSON.stringify(params.eventData),
				JSON.stringify({ agentDedupeKey: params.dedupeKey }),
			);
			[inserted] = this.ctx.storage.sql.exec<{ id: number; created_at: string }>("SELECT id, created_at FROM event_log WHERE id = last_insert_rowid()").toArray();
		});
		if (!inserted) {
			return { error: "FAILED_TO_RECORD" };
		}
		return { eventId: inserted.id, createdAt: inserted.created_at };
	}

	async recordAgentInsightEvent(params: AgentInsightEventPayload) {
		const state = this.getState();
		if ("error" in state) {
			return state;
		}

		const existing = this.ctx.storage.sql
			.exec<{ id: number; created_at: string }>(
				"SELECT id, created_at FROM event_log WHERE event_type = ? AND json_extract(event_metadata, '$.agentDedupeKey') = ? LIMIT 1",
				params.eventType,
				params.dedupeKey,
			)
			.toArray();
		if (existing.length) {
			return { eventId: existing[0]!.id, createdAt: existing[0]!.created_at, deduped: true };
		}

		let inserted: { id: number; created_at: string } | undefined;
		await this.ctx.storage.transaction(async () => {
			this.ctx.storage.sql.exec(
				"INSERT INTO event_log (event_type, event_data, event_metadata, adapter) VALUES (?, ?, ?, 'fire')",
				params.eventType,
				JSON.stringify(params.eventData),
				JSON.stringify({ agentDedupeKey: params.dedupeKey }),
			);
			await this.scheduleAlarmAtMost(Date.now());
			[inserted] = this.ctx.storage.sql.exec<{ id: number; created_at: string }>("SELECT id, created_at FROM event_log WHERE id = last_insert_rowid()").toArray();
		});

		if (!inserted) {
			return { error: "FAILED_TO_RECORD" };
		}
		return { eventId: inserted.id, createdAt: inserted.created_at, deduped: false };
	}

	async get() {
		const state = this.ctx.storage.kv.get<DOState>(STATE_KEY);
		if (!state) {
			return { error: "NOT_FOUND" };
		} else if (!state._initialized) {
			return { error: "INITIALIZING" };
		}
		const {
			metadata: { channel, thread },
			_initialized,
			...rest
		} = state;
		const events = this.ctx.storage.sql
			.exec<Omit<EventLog, "event_metadata">>("SELECT id, event_type, event_data, created_at, published_at, attempts, adapter FROM event_log ORDER BY id ASC")
			.toArray();
		return { state: rest, events, context: { channel, thread } };
	}

	async addMetadata(metadata: Record<string, string>) {
		const state = this.getState();
		if ("error" in state) {
			return state;
		}
		state.metadata = { ...state.metadata, ...metadata };
		await this.commit({ state });
		return state;
	}
}
