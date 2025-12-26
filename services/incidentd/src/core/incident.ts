import { DurableObject } from "cloudflare:workers";
import type { EntryPoint, IS, IS_Event } from "@fire/common";
import type { Metadata } from "../handler";
import { ASSERT } from "../lib/utils";
import { calculateIncidentInfo } from "./idontknowhowtonamethisitswhereillplacecallstoai";

export type DOState = IS & {
	metadata: Metadata;
	_initialized: boolean;
};

type EventLog = {
	id: number;
	created_at: string;
	event_type: IS_Event["event_type"];
	event_data: string;
	published_at: string | null;
	attempts: number;
};

const S_KEY = "S";
const ELV_KEY = "ELV";
const EP_KEY = "EP";
const OUTBOX_FLUSH_DELAY_MS = 100;
const MAX_ATTEMPTS = 3;

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
 * - A state update is (transactionally) committed iff an alarm is scheduled in at most `OUTBOX_FLUSH_DELAY_MS` milliseconds
 * - An Incident exists iff `start` is called. Otherwise, it rejects all other calls.
 *
 * Acknowledge callers on state persistence, not on side effects:
 * - LLM calls are executed in the alarm handler (non-blocking, can only run one at a time).
 * - We attempt side-effects after state persistence (fast path), and fall back to the alarm to ensure durable execution.
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

	private assertState() {
		const state = this.ctx.storage.kv.get<DOState>(S_KEY);
		ASSERT(state?._initialized, "Incident not initialized");
		return state;
	}

	private async scheduleAlarmAtMost(time: number) {
		const existingAlarm = await this.ctx.storage.getAlarm();
		if (existingAlarm && existingAlarm <= time) {
			return;
		}
		await this.ctx.storage.setAlarm(time);
	}

	async alarm() {
		let state = this.ctx.storage.kv.get<DOState>(S_KEY);
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
			state = this.ctx.storage.kv.get<DOState>(S_KEY)!;
		}
		const events = this.ctx.storage.sql.exec<EventLog>("SELECT * FROM event_log WHERE published_at IS NULL AND attempts < ? ORDER BY id ASC LIMIT 100", MAX_ATTEMPTS).toArray();
		if (events.length > 0) {
			for (const event of events) {
				try {
					await this.env.incidentd.dispatch(
						{
							event_type: event.event_type,
							event_data: JSON.parse(event.event_data),
							event_id: event.id,
							incident_id: state.id,
						},
						state,
					);
					this.ctx.storage.sql.exec("UPDATE event_log SET published_at = CURRENT_TIMESTAMP WHERE id = ? AND published_at IS NULL", event.id);
				} catch (error) {
					const attempts = event.attempts + 1;
					if (attempts >= MAX_ATTEMPTS) {
						console.error("Event failed after MAX_ATTEMPTS attempts, giving up", MAX_ATTEMPTS, event, error);
					} else {
						console.warn("Error dispatching event", event, error);
					}
					this.ctx.storage.sql.exec("UPDATE event_log SET attempts = ? WHERE id = ?", attempts, event.id);
					throw error;
				}
			}
		}

		const remaining = this.ctx.storage.sql.exec<{ id: number }>("SELECT id FROM event_log WHERE published_at IS NULL AND attempts < ? LIMIT 1", MAX_ATTEMPTS).toArray();
		if (remaining.length) {
			await this.scheduleAlarmAtMost(Date.now() + OUTBOX_FLUSH_DELAY_MS);
		} else {
			if (state.status === "resolved") {
				await this.destroy();
			}
		}
	}

	/**
	 * Initialize the incident. ALWAYS check if it's already initialized before calling this.
	 */
	private async init({ id, prompt, createdBy, source, metadata }: Pick<DOState, "id" | "prompt" | "createdBy" | "source" | "metadata">) {
		const entryPoints = this.ctx.storage.kv.get<EntryPoint[]>(EP_KEY);
		if (!entryPoints?.length) {
			throw new Error("No entry points found");
		}
		const { assignee, severity, title, description } = await calculateIncidentInfo(prompt, entryPoints, this.env.OPENAI_API_KEY);
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
			metadata,
			_initialized: true,
		} as const;
		await this.ctx.storage.transaction(async () => {
			this.ctx.storage.sql.exec(`CREATE TABLE event_log (
				id INTEGER PRIMARY KEY,
				event_type TEXT NOT NULL,
				event_data TEXT NOT NULL CHECK (json_valid(event_data)) NOT NULL,
				created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
				published_at TEXT DEFAULT NULL,
				attempts INTEGER NOT NULL DEFAULT 0
			);
			CREATE INDEX idx_event_log_published_at ON event_log(published_at);`);
			this.ctx.storage.kv.put(ELV_KEY, "1");
			await this.commit(payload, { event_type: "INCIDENT_CREATED", event_data: { assignee, createdBy, description, prompt, severity, source, status, title } });
			this.ctx.storage.kv.delete(EP_KEY);
		});
		return payload;
	}

	/**
	 * Assumes `state` is already committed to the DO.
	 * Outbox pattern
	 * Atomically: commits the new state to the DO, enqueues an event to the event log and schedules an alarm to ensure eventual consistency.
	 * Fast path: publishes the event.
	 */
	private async commit(state: DOState, event: IS_Event | undefined) {
		const eventLog = await this.ctx.storage.transaction(async () => {
			this.ctx.storage.kv.put<DOState>(S_KEY, state);
			let eventLog: Exclude<EventLog, "created_at"> | undefined;
			if (event) {
				eventLog = this.ctx.storage.sql
					.exec<Exclude<EventLog, "created_at">>(
						"INSERT INTO event_log (event_type, event_data) VALUES (?, ?) RETURNING id, event_type, event_data",
						event.event_type,
						JSON.stringify(event.event_data),
					)
					.one();
			}
			if (event) {
				await this.scheduleAlarmAtMost(Date.now() + OUTBOX_FLUSH_DELAY_MS);
			}
			return eventLog;
		});
		if (eventLog?.id) {
			// `waitUntil` is no-op (by default has this behavior), I choose to add it for consistency
			this.ctx.waitUntil(
				this.fastPath(eventLog).catch(() => {
					console.warn("Fast path failed for event", eventLog);
				}),
			);
		}
	}

	private async fastPath(eventLog: Exclude<EventLog, "created_at">) {
		const state = this.assertState();
		const eventId = eventLog.id;
		const eventType = eventLog.event_type;
		const eventData = JSON.parse(eventLog.event_data);
		const incidentId = state.id;
		await this.env.incidentd.dispatch({ incident_id: incidentId, event_id: eventId, event_type: eventType, event_data: eventData }, state);
		this.ctx.storage.sql.exec("UPDATE event_log SET published_at = CURRENT_TIMESTAMP WHERE id = ? AND published_at IS NULL", eventId);
	}

	private async destroy() {
		// TODO: Persist events
		await Promise.all([this.ctx.storage.deleteAlarm(), this.ctx.storage.deleteAll()]);
	}

	/**
	 * Entry point to start a new incident. Must be called before any other method.
	 */
	async start({ id, prompt, createdBy, source, metadata }: Pick<DOState, "id" | "prompt" | "createdBy" | "source" | "metadata">, entryPoints: EntryPoint[]) {
		const state = this.ctx.storage.kv.get<DOState>(S_KEY);
		if (!state) {
			await this.ctx.storage.transaction(async () => {
				this.ctx.storage.kv.put<DOState>(S_KEY, {
					id,
					prompt,
					createdBy,
					source,
					metadata,
					createdAt: new Date(),
					status: "open",
					// This will be set on `init`
					severity: "medium",
					assignee: "",
					title: "",
					description: "",
					_initialized: false,
					// This will be set on `init`
				});
				this.ctx.storage.kv.put(EP_KEY, entryPoints);
				await this.ctx.storage.setAlarm(Date.now());
			});
		}
	}

	async setSeverity(severity: DOState["severity"]) {
		const state = this.assertState();
		if (state.severity !== severity) {
			state.severity = severity;
			await this.commit(state, { event_type: "SEVERITY_UPDATE", event_data: { severity } });
		}
	}

	async setAssignee(assignee: DOState["assignee"]) {
		const state = this.assertState();
		if (state.assignee !== assignee) {
			state.assignee = assignee;
			await this.commit(state, { event_type: "ASSIGNEE_UPDATE", event_data: { assignee } });
		}
	}

	async updateStatus(status: DOState["status"], message: string) {
		const state = this.assertState();
		const currentStatus = state.status;

		const invalidTransition = currentStatus === "resolved" || (currentStatus === "mitigating" && status === "open");
		const statusChange = currentStatus !== status;
		if (invalidTransition || !statusChange) {
			return;
		}

		state.status = status;
		await this.commit(state, { event_type: "STATUS_UPDATE", event_data: { status, message } });
	}

	async get() {
		const state = this.ctx.storage.kv.get<DOState>(S_KEY);
		if (!state) {
			return { error: "NOT_FOUND" };
		}
		const { metadata, _initialized, ...rest } = state;
		if (!state._initialized) {
			throw new Error("Unreachable");
		}
		const events = this.ctx.storage.sql.exec<EventLog>("SELECT * FROM event_log ORDER BY id ASC").toArray();
		return { state: rest, events };
	}

	async addMetadata(metadata: Record<string, string>) {
		const state = this.assertState();
		state.metadata = { ...state.metadata, ...metadata };
		await this.commit(state, undefined);
		return state;
	}
}
