import { DurableObject } from "cloudflare:workers";
import OpenAI from "openai";
import { formatAgentEventForPrompt, isInternalAgentEvent } from "../event-format";
import { normalizeEventData } from "../suggestions";
import type { AgentEvent } from "../types";
import type { AddContextInput, AddContextResult, AgentExport, ExportedAgentContext, ExportedAgentStep, PromptInput, PromptResult } from "./types";

const LAST_PROCESSED_EVENT_ID_KEY = "lastProcessedEventId";
const MAX_QUEUED_TO_EVENT_ID_KEY = "maxQueuedToEventId";
const RUN_STATUS_KEY = "runStatus";
const INCIDENT_ID_KEY = "incidentId";

export const RUN_STATUS_IDLE = "idle";
export const RUN_STATUS_RUNNING = "running";
type RunStatus = typeof RUN_STATUS_IDLE | typeof RUN_STATUS_RUNNING;

export abstract class AgentBase extends DurableObject<Env> {
	protected incidentId?: string;

	protected abstract readonly providerMeta: { name: string; description: string };
	protected abstract readonly systemPrompt: string;
	protected abstract readonly summarizationPrompt: string;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.incidentId = this.ctx.storage.kv.get(INCIDENT_ID_KEY);
	}

	async addContext(input: AddContextInput & { incidentId: string }) {
		if (!this.incidentId) {
			this.incidentId = input.incidentId;
			await this.ctx.blockConcurrencyWhile(() => this.migrateBaseSchema(input.incidentId));
		} else if (this.incidentId !== input.incidentId) {
			throw new Error("AGENT_INCIDENT_ID_MISMATCH");
		}
		return this.ingestContext(input);
	}

	private async ingestContext(input: AddContextInput): Promise<AddContextResult> {
		const toEventId = Math.max(0, Math.floor(input.toEventId));
		if (!toEventId) {
			return {
				deduped: true,
				enqueuedToEventId: this.getMaxQueuedToEventId(),
			};
		}

		const maxQueuedToEventId = this.getMaxQueuedToEventId();
		if (toEventId <= maxQueuedToEventId) {
			return {
				deduped: true,
				enqueuedToEventId: maxQueuedToEventId,
			};
		}

		const [existingContext] = this.ctx.storage.sql.exec<{ id: number }>("SELECT id FROM contexts WHERE to_event_id = ? LIMIT 1", toEventId).toArray();
		if (existingContext) {
			this.setMaxQueuedToEventId(Math.max(maxQueuedToEventId, toEventId));
			await this.ensureRunScheduled();
			return {
				deduped: true,
				enqueuedToEventId: Math.max(maxQueuedToEventId, toEventId),
			};
		}

		const fromEventId = Math.max(this.getLastProcessedEventId(), maxQueuedToEventId);
		const newEvents = input.events.filter((e) => e.id > fromEventId && e.id <= toEventId);

		let startStepId: number | null = null;
		let endStepId: number | null = null;
		let summary: string | null = null;
		try {
			summary = await this.summarizeNewContext({
				existingInput: this.listModelInputItems(),
				newEvents,
			});
		} catch (error) {
			console.error("Context summarization failed", error);
		}

		this.ctx.storage.transactionSync(() => {
			this.ctx.storage.sql.exec("INSERT INTO contexts (to_event_id, trigger, requested_at) VALUES (?, ?, ?)", toEventId, input.trigger, input.requestedAt);

			if (summary) {
				const insertedId = this.appendStep({
					role: "user",
					content: summary,
					source: "context",
					contextToEventId: toEventId,
				});
				if (insertedId !== undefined) {
					startStepId = insertedId;
					endStepId = insertedId;
				}
			}

			this.ctx.storage.sql.exec("UPDATE contexts SET appended_step_start_id = ?, appended_step_end_id = ? WHERE to_event_id = ?", startStepId, endStepId, toEventId);
			this.setMaxQueuedToEventId(toEventId);
		});

		await this.ensureRunScheduled();
		return {
			deduped: false,
			enqueuedToEventId: toEventId,
		};
	}

	private async summarizeNewContext(params: { existingInput: OpenAI.Responses.ResponseInputItem[]; newEvents: AgentEvent[] }): Promise<string | null> {
		if (!params.newEvents.length) {
			return null;
		}

		const formatted = params.newEvents
			.map((event) => {
				const ts = event.created_at;
				if (isInternalAgentEvent(event)) {
					return `[${ts}] ${formatAgentEventForPrompt(event)}`;
				}
				return `[${ts}] ${event.event_type}: ${JSON.stringify(normalizeEventData(event.event_data))}`;
			})
			.join("\n");

		const input: OpenAI.Responses.ResponseInputItem[] = [...params.existingInput, { role: "user", content: `New incident events:\n${formatted}\n\n${this.summarizationPrompt}` }];

		const client = new OpenAI({ apiKey: this.env.OPENAI_API_KEY });
		const response = await client.responses.create({
			model: "gpt-5.2",
			input,
			text: {},
		});

		const text = response.output_text.trim();
		if (!text || text === "SKIP") {
			return null;
		}
		return text;
	}

	async addPrompt(input: PromptInput) {
		if (!this.incidentId) {
			return null;
		}
		return this.prompt(input);
	}
	protected abstract prompt(input: PromptInput): Promise<PromptResult>;

	protected getIncidentStub() {
		if (!this.incidentId) {
			throw new Error("Agent not initialized. `addContext` has not been called yet");
		}
		return this.env.INCIDENT.get(this.env.INCIDENT.idFromString(this.incidentId));
	}

	protected getLastProcessedEventId() {
		return this.ctx.storage.kv.get<number>(LAST_PROCESSED_EVENT_ID_KEY) ?? 0;
	}

	protected setLastProcessedEventId(value: number) {
		this.ctx.storage.kv.put<number>(LAST_PROCESSED_EVENT_ID_KEY, value);
	}

	protected getMaxQueuedToEventId() {
		return this.ctx.storage.kv.get<number>(MAX_QUEUED_TO_EVENT_ID_KEY) ?? 0;
	}

	protected setMaxQueuedToEventId(value: number) {
		this.ctx.storage.kv.put<number>(MAX_QUEUED_TO_EVENT_ID_KEY, value);
	}

	protected getRunStatus(): RunStatus {
		return this.ctx.storage.kv.get<RunStatus>(RUN_STATUS_KEY) ?? RUN_STATUS_IDLE;
	}

	protected setRunStatus(status: RunStatus) {
		this.ctx.storage.kv.put<RunStatus>(RUN_STATUS_KEY, status);
	}

	protected async ensureRunScheduled() {
		if (this.getRunStatus() === RUN_STATUS_RUNNING) {
			return;
		}
		if (this.getLastProcessedEventId() >= this.getMaxQueuedToEventId()) {
			return;
		}
		await this.ctx.storage.setAlarm(Date.now());
	}

	protected appendStep(params: {
		role: "system" | "user" | "assistant" | "tool" | "function_call";
		content: string;
		source: "context" | "prompt" | "runner" | "tool-result";
		name?: string | null;
		toolCallId?: string | null;
		contextToEventId?: number | null;
		runId?: string | null;
	}) {
		this.ctx.storage.sql.exec(
			"INSERT INTO steps (role, content, name, tool_call_id, source, context_to_event_id, run_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
			params.role,
			params.content,
			params.name ?? null,
			params.toolCallId ?? null,
			params.source,
			params.contextToEventId ?? null,
			params.runId ?? null,
		);
		const [inserted] = this.ctx.storage.sql.exec<{ id: number }>("SELECT id FROM steps WHERE id = last_insert_rowid()").toArray();
		return inserted?.id;
	}

	protected listModelInputItems() {
		const rows = this.ctx.storage.sql
			.exec<{
				role: string;
				content: string;
				name: string | null;
				tool_call_id: string | null;
			}>("SELECT role, content, name, tool_call_id FROM steps ORDER BY id ASC")
			.toArray();
		const input: OpenAI.Responses.ResponseInputItem[] = [];
		for (const row of rows) {
			if (row.role === "function_call") {
				if (!row.tool_call_id || !row.name) {
					continue;
				}
				input.push({
					type: "function_call",
					call_id: row.tool_call_id,
					name: row.name,
					arguments: row.content,
				});
				continue;
			}
			if (row.role === "tool") {
				if (!row.tool_call_id) {
					continue;
				}
				input.push({
					type: "function_call_output",
					call_id: row.tool_call_id,
					output: row.content,
				});
				continue;
			}
			if (row.role !== "system" && row.role !== "user" && row.role !== "assistant") {
				continue;
			}
			input.push({
				role: row.role,
				content: row.content,
			});
		}
		return input;
	}

	protected latestAssistantStep() {
		const [row] = this.ctx.storage.sql.exec<{ content: string }>("SELECT content FROM steps WHERE role = 'assistant' ORDER BY id DESC LIMIT 1").toArray();
		return row?.content ?? "";
	}

	exportData(): AgentExport | null {
		if (!this.incidentId) {
			return null;
		}
		const steps = this.ctx.storage.sql
			.exec<ExportedAgentStep>("SELECT id, role, content, name, tool_call_id, source, context_to_event_id, run_id, created_at FROM steps ORDER BY id ASC")
			.toArray()
			.map((r) => ({
				id: r.id,
				role: r.role,
				content: r.content,
				name: r.name,
				tool_call_id: r.tool_call_id,
				source: r.source,
				context_to_event_id: r.context_to_event_id,
				run_id: r.run_id,
				created_at: r.created_at,
			}));
		const contexts = this.ctx.storage.sql
			.exec<ExportedAgentContext>("SELECT id, to_event_id, trigger, requested_at, appended_step_start_id, appended_step_end_id, created_at FROM contexts ORDER BY id ASC")
			.toArray()
			.map((r) => ({
				id: r.id,
				to_event_id: r.to_event_id,
				trigger: r.trigger,
				requested_at: r.requested_at,
				appended_step_start_id: r.appended_step_start_id,
				appended_step_end_id: r.appended_step_end_id,
				created_at: r.created_at,
			}));
		return {
			provider: this.providerMeta,
			incidentId: this.incidentId,
			steps,
			contexts,
		};
	}

	async cleanup(): Promise<void> {
		await Promise.all([this.ctx.storage.deleteAlarm(), this.ctx.storage.deleteAll()]);
	}

	private async migrateBaseSchema(incidentId: string) {
		this.ctx.storage.transactionSync(() => {
			this.ctx.storage.sql.exec(
				`
				CREATE TABLE IF NOT EXISTS contexts (
					id INTEGER PRIMARY KEY,
					to_event_id INTEGER NOT NULL UNIQUE,
					trigger TEXT NOT NULL,
					requested_at TEXT NOT NULL,
					appended_step_start_id INTEGER,
					appended_step_end_id INTEGER,
					created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
				);
				CREATE TABLE IF NOT EXISTS steps (
					id INTEGER PRIMARY KEY,
					role TEXT NOT NULL,
					content TEXT NOT NULL,
					name TEXT,
					tool_call_id TEXT,
					source TEXT NOT NULL,
					context_to_event_id INTEGER,
					run_id TEXT,
					created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
				);
				CREATE INDEX IF NOT EXISTS idx_contexts_to_event_id ON contexts(to_event_id);
				CREATE INDEX IF NOT EXISTS idx_steps_created_at ON steps(created_at);
				CREATE INDEX IF NOT EXISTS idx_steps_context_to_event_id ON steps(context_to_event_id);
				CREATE UNIQUE INDEX IF NOT EXISTS idx_steps_system_source_unique ON steps(source) WHERE source = 'system';
				INSERT OR IGNORE INTO steps (role, content, source) VALUES ('system', ?, 'system');
			`,
				this.systemPrompt,
			);
			this.ctx.storage.kv.put(INCIDENT_ID_KEY, incidentId);
		});
	}
}
