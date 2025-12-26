import { DurableObject } from "cloudflare:workers";
import type { EntryPoint, EventLog, IS, IS_Event } from "@fire/common";
import type { Metadata } from "../handler";
import { ASSERT } from "../lib/utils";
import { calculateIncidentInfo } from "./idontknowhowtonamethisitswhereillplacecallstoai";

export type DOState = IS & {
	metadata: Metadata;
	_initialized: boolean;
};

const S_KEY = "S";
const ELV_KEY = "ELV";
const EP_KEY = "EP";
const ALARM_INTERVAL_MS = 200;
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
 * - A state update is (transactionally) committed iff an alarm is scheduled
 * - An Incident exists iff `start` is called. Otherwise, it rejects all other calls.
 * - An event is dispatched only when all previous events have been published or failed MAX_ATTEMPTS times.
 *
 * Acknowledge callers on state persistence, not on side effects:
 * - All side effects are executed in the alarm handler (non-blocking, can only run one at a time).
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

	/**
	 * Either succeeds and there is no unpublished event
	 * or fails throwing an error (and retries)
	 */
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
						state.metadata,
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
			await this.scheduleAlarmAtMost(Date.now() + ALARM_INTERVAL_MS);
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
			await this.commit(
				{ state: payload, event: { event_type: "INCIDENT_CREATED", event_data: { assignee, createdBy, description, prompt, severity, source, status, title } } },
				{ skipAlarm: true },
			);
			this.ctx.storage.kv.delete(EP_KEY);
		});
		return payload;
	}

	/**
	 * Assumes `state` is already committed to the DO.
	 * Outbox pattern
	 * Atomically: commits the new state to the DO, enqueues an event to the event log and schedules an alarm to ensure eventual consistency.
	 */
	private async commit({ state, event }: { state: DOState; event?: IS_Event }, { skipAlarm = false }: { skipAlarm?: boolean } = {}) {
		await this.ctx.storage.transaction(async () => {
			this.ctx.storage.kv.put<DOState>(S_KEY, state);
			if (event) {
				this.ctx.storage.sql.exec("INSERT INTO event_log (event_type, event_data) VALUES (?, ?)", event.event_type, JSON.stringify(event.event_data));
				if (!skipAlarm) {
					await this.scheduleAlarmAtMost(Date.now());
				}
			}
		});
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
			await this.commit({ state, event: { event_type: "SEVERITY_UPDATE", event_data: { severity } } });
		}
	}

	async setAssignee(assignee: DOState["assignee"]) {
		const state = this.assertState();
		if (state.assignee !== assignee) {
			state.assignee = assignee;
			await this.commit({ state, event: { event_type: "ASSIGNEE_UPDATE", event_data: { assignee } } });
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
		await this.commit({ state, event: { event_type: "STATUS_UPDATE", event_data: { status, message } } });
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
		await this.commit({ state });
		return state;
	}
}
