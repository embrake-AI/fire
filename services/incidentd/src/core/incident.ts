import { DurableObject } from "cloudflare:workers";
import type { IS, IS_Event } from "@fire/common";
import type { Metadata } from "../handler";
import { ASSERT } from "../lib/utils";

async function calculateIncidentInfo(_prompt: string) {
	const assignee = "U05G1BLH2SU"; //await getAssigneeFromPrompt(prompt)
	const severity: IS["severity"] = "low"; //await getSeverityFromPrompt(prompt)
	const title = "random-title"; //await getTitleFromPrompt(prompt)
	const description = "random-description, a bit longer or it doesnt look like a description"; //await getDescriptionFromPrompt(prompt)
	return { assignee, severity, title, description };
}

export type DOState = IS & {
	metadata: Metadata;
};

type EventLog = {
	id: number;
	created_at: string;
	event_type: string;
	event_data: string;
};

const S_KEY = "incident";
const ELV_KEY = "event_log_version";

/**
 * An Incident is the source of truth for an incident. It is agnostic of the communication channel(s).
 * All operations guarantee transactional consistency: https://blog.cloudflare.com/durable-objects-easy-fast-correct-choose-three/
 */
export class Incident extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
	}

	private async init({ id, prompt, createdBy, source, metadata }: Pick<DOState, "id" | "prompt" | "createdBy" | "source" | "metadata">) {
		const { assignee, severity, title, description } = await calculateIncidentInfo(prompt);
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
		} as const;
		this.ctx.storage.transactionSync(() => {
			this.ctx.storage.sql.exec(`CREATE TABLE event_log (
				id INTEGER PRIMARY KEY,
				event_type TEXT NOT NULL,
				event_data TEXT NOT NULL CHECK (json_valid(event_data)),
				created_at TEXT DEFAULT CURRENT_TIMESTAMP
			);`);
			this.ctx.storage.kv.put(ELV_KEY, "1");
			this.commit(payload, { event_type: "INCIDENT_CREATED", event_data: { assignee, createdBy, description, prompt, severity, source, status, title } });
		});
		return payload;
	}

	private commit(state: DOState | undefined, event: IS_Event | undefined) {
		this.ctx.storage.transactionSync(() => {
			if (state) {
				this.ctx.storage.kv.put<DOState>(S_KEY, state);
			}
			if (event) {
				this.ctx.storage.sql.exec("INSERT INTO event_log (event_type, event_data) VALUES (?, ?)", event.event_type, JSON.stringify(event.event_data));
			}
		});
	}

	private async destroy() {
		await Promise.all([this.ctx.storage.deleteAlarm(), this.ctx.storage.deleteAll()]);
	}

	/**
	 * Entry point to start a new incident. Must be called before any other method.
	 */
	async start({ id, prompt, createdBy, source, metadata }: Pick<DOState, "id" | "prompt" | "createdBy" | "source" | "metadata">) {
		const exists = this.ctx.storage.kv.get<DOState>(S_KEY);
		if (exists) {
			return exists;
		}
		return this.ctx.blockConcurrencyWhile(() => this.init({ id, prompt, createdBy, source, metadata }));
	}

	async setSeverity(severity: DOState["severity"]) {
		const state = this.ctx.storage.kv.get<DOState>(S_KEY);
		ASSERT(state, "Incident not initialized");
		if (state.severity === severity) {
			return state;
		}
		state.severity = severity;
		this.commit(state, { event_type: "SEVERITY_UPDATE", event_data: { severity } });
		return state;
	}

	async setAssignee(assignee: DOState["assignee"]) {
		const state = this.ctx.storage.kv.get<DOState>(S_KEY);
		ASSERT(state, "Incident not initialized");
		if (state.assignee === assignee) {
			return state;
		}
		state.assignee = assignee;
		this.commit(state, { event_type: "ASSIGNEE_UPDATE", event_data: { assignee } });
		return state;
	}

	async updateStatus(status: DOState["status"], message: string) {
		const state = this.ctx.storage.kv.get<DOState>(S_KEY);
		ASSERT(state, "Incident not initialized");

		const currentStatus = state.status;

		const invalidTransition = currentStatus === "resolved" || (currentStatus === "mitigating" && status === "open");
		const noChange = currentStatus === status;
		if (invalidTransition || noChange) {
			return state;
		} else {
			state.status = status;
		}
		if (state.status === "resolved") {
			// TODO: Make sure to persist it somewhere before destroying the DO
			this.commit(undefined, { event_type: "STATUS_UPDATE", event_data: { status: "resolved", message } });
			await this.destroy();
		} else {
			this.commit(state, { event_type: "STATUS_UPDATE", event_data: { status, message } });
		}
		return state;
	}

	async get() {
		const events = this.ctx.storage.sql.exec<EventLog>("SELECT * FROM event_log ORDER BY id ASC").toArray();
		const state = this.ctx.storage.kv.get<DOState>(S_KEY);
		return { state, events };
	}

	async addMetadata(metadata: Record<string, string>) {
		const state = this.ctx.storage.kv.get<DOState>(S_KEY);
		ASSERT(state, "Incident not initialized");
		state.metadata = { ...state.metadata, ...metadata };
		this.commit(state, undefined);
		return state;
	}
}
