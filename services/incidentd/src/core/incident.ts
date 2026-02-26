import { DurableObject } from "cloudflare:workers";
import type { EntryPoint, EventLog, IS, IS_Event } from "@fire/common";
import type { IncidentEventData } from "@fire/db/schema";
import type { AgentAffectionInfo, AgentEvent, AgentIncidentSnapshot, AgentService, AgentTurnPayload } from "../agent/types";
import type { IncidentAnalysisWorkflowPayload } from "../dispatcher/analysis-workflow";
import { INCIDENT_WORKFLOW_EVENT_TYPE, type IncidentWorkflowPayload } from "../dispatcher/workflow";
import type { Metadata } from "../handler";
import { calculateIncidentInfo } from "./idontknowhowtonamethisitswhereillplacecallstoai";

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
const AGENT_INITIAL_DEBOUNCE_MS = 60_000;
const AGENT_DEBOUNCE_MS = 13_000;

type AgentState = {
	lastProcessedEventId: number;
	toEventId: number | null;
	nextAt?: number;
};

const AFFECTION_STATUS_ORDER = ["investigating", "mitigating", "resolved"] as const;
type AffectionStatus = "investigating" | "mitigating" | "resolved";
type AffectionImpact = "partial" | "major";

type AffectionUpdateData = Extract<IS_Event, { event_type: "AFFECTION_UPDATE" }>["event_data"];
type IncidentService = { id: string; name: string; prompt: string | null };
type SuggestionLogInput = { message: string; suggestionId: string; messageId: string; suggestion?: Record<string, unknown> };
type BootstrapMessage = { message: string; userId: string; messageId: string; createdAt: string };

function getAffectionStatusIndex(status: AffectionStatus) {
	return AFFECTION_STATUS_ORDER.indexOf(status);
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
				createdAt: parsed.toISOString(),
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
		} else if (state.status === "resolved") {
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

	private getAgentEventsUpTo(toId: number): AgentEvent[] {
		const rows = this.ctx.storage.sql
			.exec<Pick<EventLog, "id" | "event_type" | "event_data" | "created_at" | "adapter" | "event_metadata">>(
				"SELECT id, event_type, event_data, created_at, adapter, event_metadata FROM event_log WHERE id <= ? ORDER BY id ASC",
				toId,
			)
			.toArray();

		return rows.map((event) => ({
			id: event.id,
			event_type: event.event_type,
			event_data: JSON.parse(event.event_data),
			created_at: event.created_at,
			adapter: event.adapter,
			event_metadata: event.event_metadata ? JSON.parse(event.event_metadata) : null,
		}));
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

	private buildAgentTurnPayload(params: { state: DOState; fromEventId: number; toEventId: number; events: AgentEvent[]; affection: AgentAffectionInfo; services: AgentService[] }) {
		const { state, fromEventId, toEventId, events, affection, services } = params;
		const turnId = `${toEventId}`;
		const payload: AgentTurnPayload = {
			incidentId: state.id,
			turnId,
			fromEventId,
			toEventId,
			incident: this.buildAgentIncidentSnapshot(state),
			metadata: state.metadata,
			services,
			affection,
			events,
		};
		return payload;
	}

	private getAffectionInfoFromLog(): AgentAffectionInfo {
		const rows = this.ctx.storage.sql
			.exec<Pick<EventLog, "event_data" | "created_at">>("SELECT event_data, created_at FROM event_log WHERE event_type = 'AFFECTION_UPDATE' ORDER BY id ASC")
			.toArray();

		const hasAffection = rows.length > 0;
		let lastStatus: AgentAffectionInfo["lastStatus"];
		let lastUpdateAt: string | undefined;
		for (const row of rows) {
			const data = JSON.parse(row.event_data) as { status?: AgentAffectionInfo["lastStatus"] };
			if (data?.status) {
				lastStatus = data.status;
			}
			lastUpdateAt = row.created_at;
		}

		return { hasAffection, lastStatus, lastUpdateAt };
	}

	private async startAgentTurnWorkflow(payload: AgentTurnPayload) {
		const workflowId = `agent-turn-${payload.incidentId}-${payload.turnId}`;
		try {
			await this.env.INCIDENT_AGENT_WORKFLOW.create({ id: workflowId, params: payload });
		} catch (error) {
			if (error instanceof Error && /already.*exist/i.test(error.message)) {
				return;
			}
			throw error;
		}
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

	private async ensureWorkflowStarted(workflowId: string, payload: IncidentWorkflowPayload) {
		try {
			await this.env.INCIDENT_WORKFLOW.create({ id: workflowId, params: payload });
		} catch (error) {
			if (error instanceof Error && /already.*exist/i.test(error.message)) {
				return;
			}
			throw error;
		}
	}

	private async sendWorkflowEvent(workflowId: string, payload: IncidentWorkflowPayload) {
		const instance = await this.env.INCIDENT_WORKFLOW.get(workflowId);
		await instance.sendEvent({ type: INCIDENT_WORKFLOW_EVENT_TYPE, payload });
	}

	private async startAnalysisWorkflow() {
		const state = this.ctx.storage.kv.get<DOState>(STATE_KEY)!;
		const events = this.ctx.storage.sql
			.exec<Pick<EventLog, "id" | "event_type" | "event_data" | "adapter" | "created_at">>("SELECT id, event_type, event_data, adapter, created_at FROM event_log ORDER BY id ASC")
			.toArray();

		const eventsForStorage: IncidentEventData[] = events.map((event) => ({
			id: event.id,
			event_type: event.event_type,
			event_data: JSON.parse(event.event_data),
			adapter: event.adapter,
			created_at: event.created_at,
		}));

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
		try {
			await this.env.INCIDENT_ANALYSIS_WORKFLOW.create({ id: workflowId, params: payload });
		} catch (error) {
			if (error instanceof Error && /already.*exist/i.test(error.message)) {
				return;
			}
			throw error;
		}
	}

	private async dispatchToWorkflow(event: EventLog, state: DOState) {
		const payload = this.buildWorkflowPayload(event, state);
		const workflowId = state.id;
		if (event.event_type === "INCIDENT_CREATED") {
			await this.ensureWorkflowStarted(workflowId, payload);
		} else {
			await this.sendWorkflowEvent(workflowId, payload);
		}
	}

	/**
	 * Either succeeds and there is no unpublished event
	 * or fails throwing an error (and retries)
	 */
	async alarm() {
		let state = this.ctx.storage.kv.get<DOState>(STATE_KEY);
		if (!state) {
			return;
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
		const events = this.ctx.storage.sql.exec<EventLog>("SELECT * FROM event_log WHERE published_at IS NULL AND attempts < ? ORDER BY id ASC LIMIT 100", MAX_ATTEMPTS).toArray();
		let eventError: unknown;
		if (events.length > 0) {
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
					eventError = error;
					break;
				}
			}
		}

		if (eventError) {
			throw eventError;
		}

		const now = Date.now();
		let agentState = this.getAgentState();
		const lastDispatchedEventId = events.at(-1)?.id ?? null;
		const toEventId = lastDispatchedEventId ?? agentState.toEventId;
		if (lastDispatchedEventId !== null) {
			agentState.toEventId = lastDispatchedEventId;
			// First agent turn waits longer; afterwards use trailing-edge debounce.
			if (agentState.lastProcessedEventId === 0) {
				agentState.nextAt = now + AGENT_INITIAL_DEBOUNCE_MS;
			} else {
				agentState.nextAt = now + AGENT_DEBOUNCE_MS;
			}
			this.setAgentState(agentState);
		}

		if (agentState.nextAt && toEventId && now >= agentState.nextAt && toEventId > agentState.lastProcessedEventId) {
			try {
				const fromEventId = agentState.lastProcessedEventId;
				const events = this.getAgentEventsUpTo(toEventId);
				const services = (this.ctx.storage.kv.get<AgentService[]>(SERVICES_KEY) ?? []).map((service) => ({ id: service.id, name: service.name, prompt: service.prompt ?? null }));
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
				agentState = {
					lastProcessedEventId: toEventId,
					toEventId,
					nextAt: undefined,
				};
				this.setAgentState(agentState);
			} catch (error) {
				console.error("Failed to start agent turn workflow", error);
				await this.scheduleAlarmAtMost(Date.now() + ALARM_INTERVAL_MS);
			}
		}

		const remainingEvents = this.ctx.storage.sql.exec<{ id: number }>("SELECT id FROM event_log WHERE published_at IS NULL AND attempts < ? LIMIT 1", MAX_ATTEMPTS).toArray();
		const shouldScheduleForAgent = !!agentState.nextAt && !!agentState.toEventId && agentState.toEventId > agentState.lastProcessedEventId;
		if (remainingEvents.length) {
			await this.scheduleAlarmAtMost(Date.now() + ALARM_INTERVAL_MS);
		} else if (shouldScheduleForAgent && agentState.nextAt) {
			await this.scheduleAlarmAtMost(agentState.nextAt);
		} else if (state.status === "resolved" && !agentState.nextAt) {
			await this.destroy();
		}
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

		const invalidTransition = currentStatus === "resolved" || (currentStatus === "mitigating" && status === "open");
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
		if (!trimmedMessage) {
			return { error: "MESSAGE_REQUIRED" };
		}

		const normalizedStatus = status && AFFECTION_STATUS_ORDER.includes(status) ? status : undefined;
		const existingAffection = this.ctx.storage.sql.exec<{ id: number }>("SELECT id FROM event_log WHERE event_type = 'AFFECTION_UPDATE' LIMIT 1").toArray();
		const hasAffection = existingAffection.length > 0;

		const trimmedTitle = title?.trim() ?? "";
		const hasTitle = trimmedTitle.length > 0;
		const allowedServices = this.ctx.storage.kv.get<IncidentService[]>(SERVICES_KEY) ?? [];
		const serviceIds = new Set(allowedServices.map((service) => service.id));
		const filteredServices = Array.isArray(services) ? services.filter((service) => serviceIds.has(service.id)) : [];
		const hasServices = filteredServices.length > 0;

		if (!hasAffection) {
			if (!hasTitle) {
				return { error: "TITLE_REQUIRED" };
			}
			if (!hasServices) {
				return { error: "SERVICES_REQUIRED" };
			}
			if (normalizedStatus !== "investigating") {
				return { error: "INITIAL_STATUS_REQUIRED" };
			}
		}

		if (normalizedStatus) {
			const [lastStatusRow] = this.ctx.storage.sql
				.exec<{ status: AffectionStatus | null }>(
					"SELECT json_extract(event_data, '$.status') AS status FROM event_log WHERE event_type = 'AFFECTION_UPDATE' AND json_extract(event_data, '$.status') IS NOT NULL ORDER BY id DESC LIMIT 1",
				)
				.toArray();
			const currentStatus = lastStatusRow?.status ?? "investigating";
			const currentIndex = getAffectionStatusIndex(currentStatus);
			const nextIndex = getAffectionStatusIndex(normalizedStatus);
			if (nextIndex <= currentIndex && hasAffection) {
				return { error: "STATUS_CAN_ONLY_MOVE_FORWARD" };
			}
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

		const events = this.ctx.storage.sql
			.exec<Pick<EventLog, "id" | "event_type" | "event_data" | "created_at" | "adapter" | "event_metadata">>(
				"SELECT id, event_type, event_data, created_at, adapter, event_metadata FROM event_log ORDER BY id ASC",
			)
			.toArray()
			.map((event) => ({
				id: event.id,
				event_type: event.event_type,
				event_data: JSON.parse(event.event_data),
				created_at: event.created_at,
				adapter: event.adapter,
				event_metadata: event.event_metadata ? JSON.parse(event.event_metadata) : null,
			}));

		const services = (this.ctx.storage.kv.get<AgentService[]>(SERVICES_KEY) ?? []).map((service) => ({
			id: service.id,
			name: service.name,
			prompt: service.prompt ?? null,
		}));

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
