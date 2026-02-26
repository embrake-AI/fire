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
});
