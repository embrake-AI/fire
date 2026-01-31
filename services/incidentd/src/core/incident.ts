import { DurableObject } from "cloudflare:workers";
import type { EntryPoint, EventLog, IS, IS_Event } from "@fire/common";
import { incidentAnalysis } from "@fire/db/schema";
import { INCIDENT_WORKFLOW_EVENT_TYPE, type IncidentWorkflowPayload, type SummaryResponsePayload } from "../dispatcher/workflow";
import type { Metadata } from "../handler";
import { getDB } from "../lib/db";
import { calculateIncidentInfo, generateIncidentSummary } from "./idontknowhowtonamethisitswhereillplacecallstoai";

export type DOState = IS & {
	metadata: Metadata;
	_initialized: boolean;
};

const STATE_KEY = "S";
const EVENTLOGVERSION_KEY = "ELV";
const ENTRYPOINT_KEY = "EP";
const SERVICES_KEY = "SV";
const SUMMARY_CACHE_KEY = "SC";
const ALARM_INTERVAL_MS = 200;
const MAX_ATTEMPTS = 3;
const SUMMARY_CACHE_TTL_MS = 60_000;

type SummaryRequestContext = {
	ts: string;
	adapter: "slack" | "dashboard";
	channel: string;
	threadTs?: string;
};

type SummaryCache = {
	summary: string;
	generatedAt: number;
};

type PendingSummaryRow = {
	id: number;
	context: string;
};

const AFFECTION_STATUS_ORDER = ["investigating", "mitigating", "resolved"] as const;
type AffectionStatus = "investigating" | "mitigating" | "resolved";
type AffectionImpact = "partial" | "major";

type AffectionUpdateData = Extract<IS_Event, { event_type: "AFFECTION_UPDATE" }>["event_data"];
type IncidentService = { id: string; prompt: string | null };

function getAffectionStatusIndex(status: AffectionStatus) {
	return AFFECTION_STATUS_ORDER.indexOf(status);
}

function normalizeIncidentServices(services: IncidentService[]) {
	const serviceMap = new Map<string, IncidentService>();
	for (const service of services) {
		if (!service?.id) continue;
		if (!serviceMap.has(service.id)) {
			serviceMap.set(service.id, { id: service.id, prompt: service.prompt ?? null });
		}
	}
	return Array.from(serviceMap.values());
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
	private summaryPromise?: Promise<void>;

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

	private getCachedSummary() {
		const cache = this.ctx.storage.kv.get<SummaryCache>(SUMMARY_CACHE_KEY);
		const now = Date.now();
		if (!cache || now - cache.generatedAt >= SUMMARY_CACHE_TTL_MS) {
			return undefined;
		}
		return cache;
	}

	private getSummaryEvents() {
		const events = this.ctx.storage.sql
			.exec<Pick<EventLog, "event_type" | "event_data" | "created_at">>("SELECT event_type, event_data, created_at FROM event_log ORDER BY id ASC")
			.toArray();
		return events.map((event) => ({
			event_type: event.event_type,
			event_data: event.event_data,
			created_at: event.created_at,
		}));
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

	private buildSummaryResponsePayload(state: DOState, summaryResponse: SummaryResponsePayload): IncidentWorkflowPayload {
		return {
			kind: "summary_response",
			summary_response: summaryResponse,
			incident: {
				status: state.status,
				assignee: state.assignee.slackId,
				severity: state.severity,
				title: state.title,
				description: state.description,
			},
			metadata: state.metadata,
			adapter: summaryResponse.adapter,
		};
	}

	private async refreshSummary(state: DOState): Promise<SummaryCache> {
		const summary = await generateIncidentSummary(
			{
				title: state.title,
				description: state.description,
				severity: state.severity,
				prompt: state.prompt,
			},
			this.getSummaryEvents(),
			this.env.OPENAI_API_KEY,
		);

		const nextCache: SummaryCache = { summary, generatedAt: Date.now() };
		this.ctx.storage.transactionSync(() => {
			const nextState = this.ctx.storage.kv.get<DOState>(STATE_KEY)!;
			nextState.description = summary;
			this.ctx.storage.kv.put(SUMMARY_CACHE_KEY, nextCache);
			this.ctx.storage.kv.put(STATE_KEY, nextState);
		});
		return nextCache;
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

	private async dispatchToWorkflow(event: EventLog, state: DOState) {
		const payload = this.buildWorkflowPayload(event, state);
		const workflowId = state.id;
		if (event.event_type === "INCIDENT_CREATED") {
			await this.ensureWorkflowStarted(workflowId, payload);
		} else {
			await this.sendWorkflowEvent(workflowId, payload);
		}
	}

	private startSummaryWork(state: DOState) {
		if (this.summaryPromise) {
			return;
		}
		this.summaryPromise = this.runSummaryWork(state).finally(() => {
			this.summaryPromise = undefined;
		});
		this.ctx.waitUntil(this.summaryPromise);
	}

	private async runSummaryWork(state: DOState) {
		try {
			const summaryCache = await this.refreshSummary(state);
			const latestState = this.ctx.storage.kv.get<DOState>(STATE_KEY)!;
			const pendingSummaries = this.ctx.storage.sql.exec<PendingSummaryRow>(`SELECT id, context FROM pending_summary ORDER BY id ASC`).toArray();
			for (const pending of pendingSummaries) {
				const context = JSON.parse(pending.context) as SummaryRequestContext;
				const summaryPayload: SummaryResponsePayload = {
					incidentId: latestState.id,
					description: summaryCache.summary,
					channel: context.channel,
					threadTs: context.threadTs ?? undefined,
					ts: context.ts,
					adapter: context.adapter,
				};
				await this.sendWorkflowEvent(latestState.id, this.buildSummaryResponsePayload(latestState, summaryPayload));
				this.ctx.storage.sql.exec(`DELETE FROM pending_summary WHERE id = ?`, pending.id);
			}
		} catch (error) {
			console.error("Error generating or dispatching summary", error);
			await this.scheduleAlarmAtMost(Date.now() + ALARM_INTERVAL_MS);
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
		const hasPendingSummary = this.ctx.storage.sql.exec<{ id: number }>(`SELECT id FROM pending_summary LIMIT 1`).toArray().length > 0;
		if (hasPendingSummary) {
			this.startSummaryWork(state);
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

		const remainingEvents = this.ctx.storage.sql.exec<{ id: number }>("SELECT id FROM event_log WHERE published_at IS NULL AND attempts < ? LIMIT 1", MAX_ATTEMPTS).toArray();
		const remainingSummaries = this.ctx.storage.sql.exec<{ id: number }>(`SELECT id FROM pending_summary LIMIT 1`).toArray();
		const shouldScheduleForSummaries = remainingSummaries.length > 0 && !this.summaryPromise;
		if (remainingEvents.length || shouldScheduleForSummaries) {
			await this.scheduleAlarmAtMost(Date.now() + ALARM_INTERVAL_MS);
		} else if (state.status === "resolved") {
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
			CREATE TABLE pending_summary (
				id INTEGER PRIMARY KEY,
				context TEXT NOT NULL CHECK (json_valid(context)),
				created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
			);
			`);
			this.ctx.storage.kv.put(EVENTLOGVERSION_KEY, "1");
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
		});
		return payload;
	}

	/**
	 * Assumes `state` is already committed to the DO.
	 * Outbox pattern
	 * Atomically: commits the new state to the DO, enqueues an event to the event log and schedules an alarm to ensure eventual consistency.
	 */
	private async commit(
		{ state, event, adapter, eventMetadata }: { state: DOState; event?: IS_Event; adapter?: "slack" | "dashboard"; eventMetadata?: Record<string, string> },
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

	private async persistAnalysis() {
		const state = this.ctx.storage.kv.get<DOState>(STATE_KEY)!;
		const events = this.ctx.storage.sql
			.exec<Pick<EventLog, "id" | "event_type" | "event_data" | "adapter" | "created_at">>("SELECT id, event_type, event_data, adapter, created_at FROM event_log ORDER BY id ASC")
			.toArray();

		const eventsForStorage = events.map((e) => ({
			id: e.id,
			event_type: e.event_type,
			event_data: JSON.parse(e.event_data),
			adapter: e.adapter,
			created_at: e.created_at,
			// TODO: Add userId to the event data
		}));

		const summary = await generateIncidentSummary(
			{
				title: state.title,
				description: state.description,
				severity: state.severity,
				prompt: state.prompt,
			},
			eventsForStorage,
			this.env.OPENAI_API_KEY,
		);

		const db = getDB(this.env.db);
		await db.insert(incidentAnalysis).values({
			id: state.id,
			clientId: state.metadata.clientId,
			title: state.title,
			description: state.description,
			severity: state.severity,
			assignee: state.assignee.slackId,
			createdBy: state.createdBy,
			source: state.source,
			prompt: state.prompt,
			summary,
			events: eventsForStorage,
			createdAt: state.createdAt,
			entryPointId: state.entryPointId,
			rotationId: state.rotationId,
			teamId: state.teamId,
		});
	}

	private async destroy() {
		await this.persistAnalysis();
		await Promise.all([this.ctx.storage.deleteAlarm(), this.ctx.storage.deleteAll()]);
	}

	/**
	 * Entry point to start a new incident. Must be called before any other method.
	 */
	async start(
		{ id, prompt, createdBy, source, metadata }: Pick<DOState, "id" | "prompt" | "createdBy" | "source" | "metadata">,
		entryPoints: EntryPoint[],
		services: IncidentService[],
	) {
		const state = this.ctx.storage.kv.get<DOState>(STATE_KEY);
		if (!state) {
			await this.ctx.storage.transaction(async () => {
				const normalizedServices = normalizeIncidentServices(services);
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
				await this.ctx.storage.setAlarm(Date.now());
			});
		}
	}

	async setSeverity(severity: DOState["severity"], adapter: "slack" | "dashboard", eventMetadata?: Record<string, string>) {
		const state = this.getState();
		if ("error" in state) {
			return state;
		}
		if (state.severity !== severity) {
			state.severity = severity;
			await this.commit({ state, event: { event_type: "SEVERITY_UPDATE", event_data: { severity } }, adapter, eventMetadata });
		}
	}

	async setAssignee(assignee: DOState["assignee"], adapter: "slack" | "dashboard") {
		const state = this.getState();
		if ("error" in state) {
			return state;
		}
		if (state.assignee !== assignee) {
			state.assignee = assignee;
			await this.commit({ state, event: { event_type: "ASSIGNEE_UPDATE", event_data: { assignee } }, adapter });
		}
	}

	async updateStatus(status: DOState["status"], message: string, adapter: "slack" | "dashboard", eventMetadata?: Record<string, string>) {
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
		adapter: "slack" | "dashboard";
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
			if (status !== "investigating") {
				return { error: "INITIAL_STATUS_REQUIRED" };
			}
		}

		if (status) {
			const [lastStatusRow] = this.ctx.storage.sql
				.exec<{ status: AffectionStatus | null }>(
					"SELECT json_extract(event_data, '$.status') AS status FROM event_log WHERE event_type = 'AFFECTION_UPDATE' AND json_extract(event_data, '$.status') IS NOT NULL ORDER BY id DESC LIMIT 1",
				)
				.toArray();
			const currentStatus = lastStatusRow?.status ?? "investigating";
			const currentIndex = getAffectionStatusIndex(currentStatus);
			const nextIndex = getAffectionStatusIndex(status);
			if (nextIndex <= currentIndex && hasAffection) {
				return { error: "STATUS_CAN_ONLY_MOVE_FORWARD" };
			}
		}

		const eventData: AffectionUpdateData = {
			message: trimmedMessage,
			createdBy,
			...(status ? { status } : {}),
			...(hasTitle ? { title: trimmedTitle } : {}),
			...(hasServices ? { services: filteredServices } : {}),
		};

		await this.commit({ state, event: { event_type: "AFFECTION_UPDATE", event_data: eventData }, adapter, eventMetadata });
	}

	async respondSummary(context: SummaryRequestContext) {
		const state = this.getState();
		if ("error" in state) {
			return state;
		}

		const cache = this.getCachedSummary();
		if (!cache) {
			await this.ctx.storage.transaction(async () => {
				this.ctx.storage.sql.exec(`INSERT INTO pending_summary (context) VALUES (?)`, JSON.stringify(context));
				await this.scheduleAlarmAtMost(Date.now());
			});
			return;
		}

		const summaryPayload: SummaryResponsePayload = {
			incidentId: state.id,
			description: cache.summary,
			channel: context.channel,
			threadTs: context.threadTs ?? undefined,
			ts: context.ts,
			adapter: context.adapter,
		};

		await this.sendWorkflowEvent(state.id, this.buildSummaryResponsePayload(state, summaryPayload));
	}

	async addMessage(message: string, userId: string, messageId: string, adapter: "slack" | "dashboard", slackUserToken?: string) {
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
			eventMetadata: { adapter, ...(slackUserToken ? { slackUserToken } : {}) },
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
