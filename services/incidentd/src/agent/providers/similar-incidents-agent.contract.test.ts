import { env, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SIMILAR_PROVIDER_SYSTEM_PROMPT } from "../similar-incidents";
import type { AgentEvent } from "../types";
import { getSimilarIncidentsProvider } from "./registry";

const OPENAI_URL = "https://api.openai.com/v1/responses";

const createdIncidentIds = new Set<string>();

function createProviderHandle(seed = crypto.randomUUID()) {
	const identifier = `incident:${seed}`;
	const incidentId = env.INCIDENT.idFromName(identifier).toString();
	createdIncidentIds.add(incidentId);
	const stub = getSimilarIncidentsProvider(env, incidentId);
	return { identifier, incidentId, stub };
}

function outboundUrl(input: RequestInfo | URL) {
	if (typeof input === "string") return input;
	if (input instanceof URL) return input.toString();
	return input.url;
}

function makeMockFetch(summarizationResponse: string) {
	return (input: RequestInfo | URL): Promise<Response> => {
		const url = outboundUrl(input);
		if (url !== OPENAI_URL) {
			throw new Error(`Unexpected outbound fetch in tests: ${url}`);
		}
		return Promise.resolve(
			Response.json({
				output_text: summarizationResponse,
				output: [],
			}),
		);
	};
}

function makeTestEvents(): AgentEvent[] {
	return [
		{
			id: 1,
			event_type: "INCIDENT_CREATED",
			event_data: { title: "API Error Spike", severity: "high" },
			created_at: "2026-01-01T00:00:00Z",
			adapter: "dashboard",
		},
		{
			id: 2,
			event_type: "MESSAGE_ADDED",
			event_data: { message: "Database connection pool exhausted on us-east-1", userId: "U_TEST_1", messageId: "msg-1" },
			created_at: "2026-01-01T00:01:00Z",
			adapter: "dashboard",
		},
	];
}

describe("SimilarIncidentsAgent base contracts", () => {
	afterEach(async () => {
		await Promise.all(
			Array.from(createdIncidentIds).map(async (incidentId) => {
				const providerStub = getSimilarIncidentsProvider(env, incidentId);
				await runInDurableObject(providerStub, async (_instance, state) => {
					await state.storage.deleteAlarm();
					await state.storage.deleteAll();
				});
			}),
		);
		createdIncidentIds.clear();
		vi.unstubAllGlobals();
	});

	it("seeds exactly one system prompt step", async () => {
		const { incidentId, stub } = createProviderHandle();

		await stub.addContext({
			incidentId,
			toEventId: 0,
			events: [],
			trigger: "agent-turn",
			requestedAt: new Date().toISOString(),
		});

		await runInDurableObject(stub, async (_instance, state) => {
			const rows = state.storage.sql.exec<{ role: string; content: string; source: string }>("SELECT role, content, source FROM steps ORDER BY id ASC").toArray();

			expect(rows).toHaveLength(1);
			expect(rows[0]).toEqual({
				role: "system",
				content: SIMILAR_PROVIDER_SYSTEM_PROMPT,
				source: "system",
			});
		});
	});

	it("keeps system source unique with INSERT OR IGNORE", async () => {
		const { incidentId, stub } = createProviderHandle();

		await stub.addContext({
			incidentId,
			toEventId: 0,
			events: [],
			trigger: "agent-turn",
			requestedAt: new Date().toISOString(),
		});

		await runInDurableObject(stub, async (_instance, state) => {
			state.storage.sql.exec("INSERT OR IGNORE INTO steps (role, content, source) VALUES ('system', 'duplicate system prompt', 'system')");

			const [countRow] = state.storage.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM steps WHERE source = 'system'").toArray();
			expect(countRow?.count).toBe(1);

			const [contentRow] = state.storage.sql.exec<{ content: string }>("SELECT content FROM steps WHERE source = 'system' LIMIT 1").toArray();
			expect(contentRow?.content).toBe(SIMILAR_PROVIDER_SYSTEM_PROMPT);
		});
	});

	it("returns null from addPrompt before addContext is called", async () => {
		const { stub } = createProviderHandle();

		const result = await stub.addPrompt({
			question: "any question",
			requestedAt: new Date().toISOString(),
		});

		expect(result).toBeNull();
	});

	it("sets incidentId after addContext is called", async () => {
		const { incidentId, stub } = createProviderHandle();

		await stub.addContext({
			incidentId,
			toEventId: 0,
			events: [],
			trigger: "agent-turn",
			requestedAt: new Date().toISOString(),
		});

		const resolvedIncidentId = await runInDurableObject(stub, async (instance) => {
			// @ts-expect-error error TS2445: Property 'incidentId' is protected and only accessible within class 'AgentBase' and its subclasses.
			return instance.incidentId;
		});

		expect(resolvedIncidentId).toBe(incidentId);
	});

	it("deduplicates addContext calls with the same toEventId", async () => {
		vi.stubGlobal("fetch", makeMockFetch("Summary of events."));
		const { incidentId, stub } = createProviderHandle();

		await runInDurableObject(stub, async (instance, state) => {
			const agent = instance as import("./similar-incidents-agent").SimilarIncidentsAgent;
			const first = await agent.addContext({
				incidentId,
				toEventId: 2,
				events: makeTestEvents(),
				trigger: "agent-turn",
				requestedAt: new Date().toISOString(),
			});
			await state.storage.deleteAlarm();

			expect(first.deduped).toBe(false);
			expect(first.enqueuedToEventId).toBe(2);

			const second = await agent.addContext({
				incidentId,
				toEventId: 2,
				events: makeTestEvents(),
				trigger: "agent-turn",
				requestedAt: new Date().toISOString(),
			});
			expect(second.deduped).toBe(true);
			expect(second.enqueuedToEventId).toBe(2);
		});
	});

	it("appends exactly one summarized context step when LLM returns a summary", async () => {
		vi.stubGlobal("fetch", makeMockFetch("DB connection pool exhausted, us-east-1 affected."));
		const { incidentId, stub } = createProviderHandle();

		await runInDurableObject(stub, async (instance, state) => {
			const agent = instance as import("./similar-incidents-agent").SimilarIncidentsAgent;
			await agent.addContext({
				incidentId,
				toEventId: 2,
				events: makeTestEvents(),
				trigger: "agent-turn",
				requestedAt: new Date().toISOString(),
			});
			await state.storage.deleteAlarm();

			const rows = state.storage.sql
				.exec<{ role: string; content: string; source: string; context_to_event_id: number | null }>("SELECT role, content, source, context_to_event_id FROM steps ORDER BY id ASC")
				.toArray();

			// system prompt + one summarized context step
			expect(rows).toHaveLength(2);
			expect(rows[0]).toMatchObject({ role: "system", source: "system" });
			expect(rows[1]).toMatchObject({
				role: "user",
				content: "DB connection pool exhausted, us-east-1 affected.",
				source: "context",
				context_to_event_id: 2,
			});
		});
	});

	it("appends no context step when LLM returns SKIP", async () => {
		vi.stubGlobal("fetch", makeMockFetch("SKIP"));
		const { incidentId, stub } = createProviderHandle();

		await runInDurableObject(stub, async (instance, state) => {
			const agent = instance as import("./similar-incidents-agent").SimilarIncidentsAgent;
			await agent.addContext({
				incidentId,
				toEventId: 2,
				events: makeTestEvents(),
				trigger: "agent-turn",
				requestedAt: new Date().toISOString(),
			});
			await state.storage.deleteAlarm();

			const rows = state.storage.sql.exec<{ role: string; source: string }>("SELECT role, source FROM steps ORDER BY id ASC").toArray();

			// Only system prompt, no context step
			expect(rows).toHaveLength(1);
			expect(rows[0]).toMatchObject({ role: "system", source: "system" });
		});
	});

	it("appends no context step when summarization fails and still succeeds", async () => {
		vi.stubGlobal("fetch", (input: RequestInfo | URL): Promise<Response> => {
			const url = outboundUrl(input);
			if (url !== OPENAI_URL) {
				throw new Error(`Unexpected outbound fetch in tests: ${url}`);
			}
			return Promise.reject(new Error("OpenAI API unavailable"));
		});
		const { incidentId, stub } = createProviderHandle();

		await runInDurableObject(stub, async (instance, state) => {
			const agent = instance as import("./similar-incidents-agent").SimilarIncidentsAgent;
			const result = await agent.addContext({
				incidentId,
				toEventId: 2,
				events: makeTestEvents(),
				trigger: "agent-turn",
				requestedAt: new Date().toISOString(),
			});
			await state.storage.deleteAlarm();

			// addContext still succeeds
			expect(result.deduped).toBe(false);
			expect(result.enqueuedToEventId).toBe(2);

			const rows = state.storage.sql.exec<{ role: string; source: string }>("SELECT role, source FROM steps ORDER BY id ASC").toArray();

			// Only system prompt, no context step (summarization failed gracefully)
			expect(rows).toHaveLength(1);
			expect(rows[0]).toMatchObject({ role: "system", source: "system" });
		});
	});
});
