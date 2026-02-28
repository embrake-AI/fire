import { env, listDurableObjectIds, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

type IncidentStub = DurableObjectStub<import("./incident").Incident>;

const STATE_KEY = "S";
const SERVICES_KEY = "SV";

const SERVICES = [
	{ id: "svc-api", name: "API", prompt: null },
	{ id: "svc-web", name: "Web", prompt: null },
];

function createIncidentHandle(seed = crypto.randomUUID()) {
	const identifier = `incident:${seed}`;
	const doId = env.INCIDENT.idFromName(identifier);
	const stub = env.INCIDENT.get(doId) as IncidentStub;
	return { identifier, id: doId.toString(), stub };
}

async function seedInitializedIncident(stub: IncidentStub, id: string, identifier: string) {
	await runInDurableObject(stub, async (instance, state) => {
		(instance as { scheduleAlarmAtMost?: (time: number) => Promise<void> }).scheduleAlarmAtMost = async () => {};

		state.storage.sql.exec(`CREATE TABLE IF NOT EXISTS event_log (
			id INTEGER PRIMARY KEY,
			event_type TEXT NOT NULL,
			event_data TEXT NOT NULL CHECK (json_valid(event_data)) NOT NULL,
			event_metadata TEXT DEFAULT NULL CHECK (event_metadata IS NULL OR json_valid(event_metadata)),
			created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
			published_at TEXT DEFAULT NULL,
			attempts INTEGER NOT NULL DEFAULT 0,
			adapter TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_event_log_published_at ON event_log(published_at);
		`);

		state.storage.kv.put(STATE_KEY, {
			id,
			createdAt: new Date("2026-01-01T00:00:00.000Z"),
			status: "open",
			prompt: "Users report elevated API errors",
			severity: "medium",
			createdBy: "user-1",
			assignee: { slackId: "U_TEST_1" },
			source: "dashboard",
			title: "Seeded incident",
			description: "Seeded for contract tests",
			entryPointId: "entrypoint-fallback",
			rotationId: undefined,
			teamId: undefined,
			metadata: { clientId: "client-1", identifier },
			_initialized: true,
		});
		state.storage.kv.put(SERVICES_KEY, SERVICES);
		state.storage.sql.exec(
			"INSERT INTO event_log (event_type, event_data, adapter, published_at) VALUES ('INCIDENT_CREATED', ?, 'dashboard', CURRENT_TIMESTAMP)",
			JSON.stringify({
				status: "open",
				severity: "medium",
				createdBy: "user-1",
				title: "Seeded incident",
				description: "Seeded for contract tests",
				prompt: "Users report elevated API errors",
				source: "dashboard",
				entryPointId: "entrypoint-fallback",
				assignee: "U_TEST_1",
			}),
		);
	});
}

function eventData<T>(event: { event_data: string }) {
	return JSON.parse(event.event_data) as T;
}

function assertReady(result: Awaited<ReturnType<IncidentStub["get"]>>) {
	expect("state" in result).toBe(true);
	if (!("state" in result)) {
		throw new Error(`Expected initialized incident, got: ${JSON.stringify(result)}`);
	}
	if (!result.events) {
		throw new Error("Expected incident events");
	}
	return result;
}

describe("Incident DO core contracts", () => {
	afterEach(async () => {
		const ids = await listDurableObjectIds(env.INCIDENT);
		await Promise.all(
			ids.map(async (id) => {
				const stub = env.INCIDENT.get(id) as IncidentStub;
				await runInDurableObject(stub, async (_instance, state) => {
					await state.storage.deleteAlarm();
					await state.storage.deleteAll();
				});
			}),
		);
	});

	it("keeps outbox append order and leaves new events unpublished until alarm", async () => {
		const { stub, id, identifier } = createIncidentHandle();
		await seedInitializedIncident(stub, id, identifier);

		await stub.setSeverity("high", "dashboard");
		await stub.setAssignee({ slackId: "U_TEST_2" }, "dashboard");
		await stub.addMessage("Operator acknowledged", "U_TEST_2", "msg-ordered-1", "dashboard");

		const result = assertReady(await stub.get());

		const tail = result.events.slice(-3);
		expect(tail.map((event) => event.event_type)).toEqual(["SEVERITY_UPDATE", "ASSIGNEE_UPDATE", "MESSAGE_ADDED"]);
		expect(tail.every((event) => event.published_at === null)).toBe(true);
	});

	it("enforces status transition rules and terminal lock", async () => {
		const { stub, id, identifier } = createIncidentHandle();
		await seedInitializedIncident(stub, id, identifier);

		await stub.updateStatus("mitigating", "Mitigation in progress", "dashboard");
		await stub.updateStatus("open", "Should not reopen from mitigating", "dashboard");
		await stub.updateStatus("resolved", "Fully recovered", "dashboard");

		const severityAfterResolved = await stub.setSeverity("high", "dashboard");
		expect(severityAfterResolved).toEqual({ error: "RESOLVED" });

		const messageAfterResolved = await stub.addMessage("late message", "U_TEST_3", "msg-late", "dashboard");
		expect(messageAfterResolved).toEqual({ error: "RESOLVED" });

		const result = assertReady(await stub.get());

		const statusUpdates = result.events.filter((event) => event.event_type === "STATUS_UPDATE").map((event) => eventData<{ status: string }>(event).status);
		expect(statusUpdates).toEqual(["mitigating", "resolved"]);
	});

	it("deduplicates MESSAGE_ADDED by messageId", async () => {
		const { stub, id, identifier } = createIncidentHandle();
		await seedInitializedIncident(stub, id, identifier);

		await stub.addMessage("first copy", "U_TEST_1", "msg-dup-1", "dashboard");
		await stub.addMessage("second copy", "U_TEST_1", "msg-dup-1", "dashboard");

		const result = assertReady(await stub.get());

		const messages = result.events.filter((event) => event.event_type === "MESSAGE_ADDED");
		expect(messages).toHaveLength(1);
		expect(eventData<{ message: string; messageId: string }>(messages[0]!)).toMatchObject({
			messageId: "msg-dup-1",
			message: "first copy",
		});
	});

	it("validates affection payload and enforces forward-only affection status", async () => {
		const { stub, id, identifier } = createIncidentHandle();
		await seedInitializedIncident(stub, id, identifier);

		const missingTitle = await stub.updateAffection({
			message: "Public update",
			createdBy: "user-1",
			adapter: "dashboard",
		});
		expect(missingTitle).toEqual({ error: "TITLE_REQUIRED" });

		const created = await stub.updateAffection({
			message: "Investigating customer impact",
			status: "investigating",
			title: "API degradation",
			services: [
				{ id: "svc-api", impact: "major" },
				{ id: "svc-unknown", impact: "partial" },
			],
			createdBy: "user-1",
			adapter: "dashboard",
		});
		expect(created).toBeUndefined();

		const nonForward = await stub.updateAffection({
			message: "Still investigating",
			status: "investigating",
			createdBy: "user-1",
			adapter: "dashboard",
		});
		expect(nonForward).toEqual({ error: "STATUS_CAN_ONLY_MOVE_FORWARD" });

		const result = assertReady(await stub.get());

		const affectionEvents = result.events.filter((event) => event.event_type === "AFFECTION_UPDATE");
		expect(affectionEvents).toHaveLength(1);
		expect(eventData<{ services?: Array<{ id: string; impact: string }> }>(affectionEvents[0]!).services).toEqual([{ id: "svc-api", impact: "major" }]);
	});

	it("stores SIMILAR_INCIDENTS_DISCOVERED as auto-published internal event", async () => {
		const { stub, id, identifier } = createIncidentHandle();
		await seedInitializedIncident(stub, id, identifier);

		const first = await stub.recordSimilarIncidentsDiscovered({
			runId: "run-1",
			searchedAt: "2026-02-27T12:00:00.000Z",
			contextSnapshot: "Customers see elevated 5xx on API endpoints.",
			gateDecision: "insufficient_context",
			gateReason: "Need clearer scope confirmation.",
			openCandidateCount: 0,
			closedCandidateCount: 0,
			rankedIncidentIds: [],
			selectedIncidentIds: [],
		});

		expect(first).toBeDefined();
		expect(first).not.toEqual({ error: "NOT_FOUND" });
		expect(first).not.toEqual({ error: "NOT_INITIALIZED" });
		expect(first).not.toEqual({ error: "RESOLVED" });

		const second = await stub.recordSimilarIncidentsDiscovered({
			runId: "run-1",
			searchedAt: "2026-02-27T12:00:00.000Z",
			contextSnapshot: "Customers see elevated 5xx on API endpoints.",
			gateDecision: "insufficient_context",
			gateReason: "Need clearer scope confirmation.",
			openCandidateCount: 0,
			closedCandidateCount: 0,
			rankedIncidentIds: [],
			selectedIncidentIds: [],
		});
		expect(second).toBeDefined();
		if (first && second && "eventId" in first && "eventId" in second) {
			expect(second.eventId).toBe(first.eventId);
		}

		const result = assertReady(await stub.get());
		const discoveryEvents = result.events.filter((event) => event.event_type === "SIMILAR_INCIDENTS_DISCOVERED");
		expect(discoveryEvents).toHaveLength(1);
		const discoveryEvent = discoveryEvents[0];
		expect(discoveryEvent).toBeDefined();
		expect(discoveryEvent?.adapter).toBe("fire");
		expect(discoveryEvent?.published_at).not.toBeNull();
		expect(eventData<{ runId: string; gateDecision: string }>(discoveryEvent!)).toMatchObject({
			runId: "run-1",
			gateDecision: "insufficient_context",
		});
	});

	it("stores SIMILAR_INCIDENT as unpublished outbox event and deduplicates by run+incident", async () => {
		const { stub, id, identifier } = createIncidentHandle();
		await seedInitializedIncident(stub, id, identifier);

		const first = await stub.recordSimilarIncident({
			originRunId: "run-2",
			similarIncidentId: "inc-previous-1",
			sourceIncidentIds: ["inc-previous-1"],
			summary: "Very similar symptom pattern.",
			evidence: "Both incidents show API 503 spikes after deploy.",
			comparisonContext: "shared edge routing regression pattern",
		});
		expect(first).toBeDefined();
		expect(first).not.toEqual({ error: "NOT_FOUND" });
		expect(first).not.toEqual({ error: "NOT_INITIALIZED" });
		expect(first).not.toEqual({ error: "RESOLVED" });
		if (first && "eventId" in first) {
			expect(first.deduped).toBe(false);
		}

		const second = await stub.recordSimilarIncident({
			originRunId: "run-2",
			similarIncidentId: "inc-previous-1",
			sourceIncidentIds: ["inc-previous-1"],
			summary: "Very similar symptom pattern.",
			evidence: "Both incidents show API 503 spikes after deploy.",
			comparisonContext: "shared edge routing regression pattern",
		});
		expect(second).toBeDefined();
		if (first && second && "eventId" in first && "eventId" in second) {
			expect(second.eventId).toBe(first.eventId);
			expect(second.deduped).toBe(true);
		}

		const result = assertReady(await stub.get());
		const similarEvents = result.events.filter((event) => event.event_type === "SIMILAR_INCIDENT");
		expect(similarEvents).toHaveLength(1);
		expect(similarEvents[0]?.adapter).toBe("fire");
		expect(similarEvents[0]?.published_at).toBeNull();
		expect(eventData<{ similarIncidentId: string; originRunId: string }>(similarEvents[0]!)).toMatchObject({
			originRunId: "run-2",
			similarIncidentId: "inc-previous-1",
		});
	});

	it("stores generic agent context and insight events with dedupe key semantics", async () => {
		const { stub, id, identifier } = createIncidentHandle();
		await seedInitializedIncident(stub, id, identifier);

		const contextEvent = {
			runId: "run-generic-1",
			searchedAt: "2026-02-27T12:05:00.000Z",
			contextSnapshot: "Search context snapshot",
			gateDecision: "run" as const,
			openCandidateCount: 3,
			closedCandidateCount: 2,
			rankedIncidentIds: ["inc-a", "inc-b"],
			selectedIncidentIds: ["inc-a"],
		};
		const contextFirst = await stub.recordAgentContextEvent({
			eventType: "SIMILAR_INCIDENTS_DISCOVERED",
			eventData: contextEvent,
			dedupeKey: "generic-discovery-key",
		});
		const contextSecond = await stub.recordAgentContextEvent({
			eventType: "SIMILAR_INCIDENTS_DISCOVERED",
			eventData: contextEvent,
			dedupeKey: "generic-discovery-key",
		});
		if (contextFirst && contextSecond && "eventId" in contextFirst && "eventId" in contextSecond) {
			expect(contextSecond.eventId).toBe(contextFirst.eventId);
		}

		const insightEvent = {
			originRunId: "run-generic-2",
			similarIncidentId: "inc-previous-42",
			sourceIncidentIds: ["inc-previous-42"],
			summary: "Matched outage pattern.",
			evidence: "Shared trigger and same rollback mitigation path.",
			comparisonContext: "same deployment edge case",
		};
		const insightFirst = await stub.recordAgentInsightEvent({
			eventType: "SIMILAR_INCIDENT",
			eventData: insightEvent,
			dedupeKey: "generic-match-key",
		});
		const insightSecond = await stub.recordAgentInsightEvent({
			eventType: "SIMILAR_INCIDENT",
			eventData: insightEvent,
			dedupeKey: "generic-match-key",
		});
		if (insightFirst && insightSecond && "eventId" in insightFirst && "eventId" in insightSecond) {
			expect(insightSecond.eventId).toBe(insightFirst.eventId);
			expect(insightSecond.deduped).toBe(true);
		}

		const result = assertReady(await stub.get());
		const discoveryEvents = result.events.filter((event) => event.event_type === "SIMILAR_INCIDENTS_DISCOVERED");
		const similarEvents = result.events.filter((event) => event.event_type === "SIMILAR_INCIDENT");
		expect(discoveryEvents).toHaveLength(1);
		expect(similarEvents).toHaveLength(1);
		expect(discoveryEvents[0]?.published_at).not.toBeNull();
		expect(similarEvents[0]?.published_at).toBeNull();
	});

	it("returns bounded event ranges for provider context ingestion", async () => {
		const { stub, id, identifier } = createIncidentHandle();
		await seedInitializedIncident(stub, id, identifier);

		await stub.setSeverity("high", "dashboard");
		await stub.addMessage("Context message A", "U_TEST_1", "msg-range-1", "dashboard");
		await stub.addMessage("Context message B", "U_TEST_1", "msg-range-2", "dashboard");

		const full = await stub.getAgentContext();
		expect("error" in full).toBe(false);
		if ("error" in full) {
			return;
		}
		const lastEventId = full.events.at(-1)?.id ?? 0;
		const fromEventId = Math.max(0, lastEventId - 1);
		const range = await stub.getAgentContextRange({
			fromEventIdExclusive: fromEventId,
			toEventIdInclusive: lastEventId,
		});

		expect("error" in range).toBe(false);
		if ("error" in range) {
			return;
		}

		expect(range.fromEventIdExclusive).toBe(fromEventId);
		expect(range.toEventIdInclusive).toBe(lastEventId);
		expect(range.events.every((event) => event.id > fromEventId && event.id <= lastEventId)).toBe(true);
		expect(range.events.length).toBeGreaterThanOrEqual(1);
	});

	// TODO: @Miquel =>  Prob remove this behavior
	it("does not trigger a new agent turn from SIMILAR_INCIDENT-only updates", async () => {
		const { stub, id, identifier } = createIncidentHandle();
		await seedInitializedIncident(stub, id, identifier);

		await stub.recordSimilarIncident({
			originRunId: "run-3",
			similarIncidentId: "inc-previous-2",
			sourceIncidentIds: ["inc-previous-2"],
			summary: "Comparable elevated API error spikes.",
			evidence: "Same error class, similar timeline around deploy.",
			comparisonContext: "similar mitigation path expected",
		});

		const alarmResult = await runInDurableObject(stub, async (instance, state) => {
			let startedAgentTurnCount = 0;
			(instance as { dispatchToWorkflow?: (event: unknown, state: unknown) => Promise<void> }).dispatchToWorkflow = async () => {};
			(instance as { startAgentTurnWorkflow?: (payload: unknown) => Promise<void> }).startAgentTurnWorkflow = async () => {
				startedAgentTurnCount += 1;
			};
			const incident = instance as import("./incident").Incident;
			await incident.alarm();
			const agentState = state.storage.kv.get<{ lastProcessedEventId: number; toEventId: number | null; nextAt?: number }>("AG");
			return { startedAgentTurnCount, agentState };
		});

		expect(alarmResult.startedAgentTurnCount).toBe(0);
		expect(alarmResult.agentState?.lastProcessedEventId ?? 0).toBe(0);
		expect(alarmResult.agentState?.toEventId ?? null).toBeNull();
	});
});
