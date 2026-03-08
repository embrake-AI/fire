import { env, listDurableObjectIds, runInDurableObject } from "cloudflare:test";
import type { EntryPoint } from "@fire/common";
import type { Context } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import * as dashboardSender from "../adapters/dashboard/sender";
import { type AuthContext, addMessage, startIncident } from "./index";

type IncidentStub = DurableObjectStub<import("../core/incident").Incident>;

const STATE_KEY = "S";

const ENTRY_POINTS: EntryPoint[] = [
	{
		id: "entrypoint-api",
		prompt: "API failures and outages",
		assignee: { id: "user-1", slackId: "U_TEST_1" },
		isFallback: false,
		rotationId: "rotation-api",
		teamId: "team-api",
	},
];

const SERVICES = [{ id: "svc-api", name: "API", prompt: "Public API availability" }];

function makeContext(clientId = "client-1") {
	return {
		env,
		var: { auth: { clientId } },
	} as unknown as Context<AuthContext>;
}

async function clearIncidentIndex() {
	await env.incidents.prepare("DELETE FROM incident").run();
}

async function seedInitializedIncident({ stub, id, identifier, clientId = "client-1" }: { stub: IncidentStub; id: string; identifier: string; clientId?: string }) {
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
			description: "Seeded for handler tests",
			entryPointId: "entrypoint-api",
			rotationId: "rotation-api",
			teamId: "team-api",
			metadata: { clientId, identifier },
			_initialized: true,
		});

		state.storage.sql.exec(
			"INSERT INTO event_log (event_type, event_data, adapter, published_at) VALUES ('INCIDENT_CREATED', ?, 'dashboard', CURRENT_TIMESTAMP)",
			JSON.stringify({
				status: "open",
				severity: "medium",
				createdBy: "user-1",
				title: "Seeded incident",
				description: "Seeded for handler tests",
				prompt: "Users report elevated API errors",
				source: "dashboard",
				entryPointId: "entrypoint-api",
				rotationId: "rotation-api",
				assignee: "U_TEST_1",
			}),
		);
	});
}

function runStep<T>(name: string, configOrCallback: unknown, callback?: () => Promise<T>) {
	void name;
	if (typeof configOrCallback === "function") {
		return (configOrCallback as () => Promise<T>)();
	}
	if (!callback) {
		throw new Error("Missing step callback");
	}
	return callback();
}

describe("Handler contracts", () => {
	afterEach(async () => {
		await clearIncidentIndex();
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

	it("starts incidents with newUniqueId and inserts a placeholder routing row", async () => {
		const identifier = "slack-thread:C123-1712345678.000100";
		const generatedIds = [crypto.randomUUID(), crypto.randomUUID()];
		const mockIncidentStub = {
			start: async () => {},
		};
		const mockIncidentNamespace = {
			newUniqueId: () => {
				const next = generatedIds.shift();
				if (!next) {
					throw new Error("No mock incident ids left");
				}
				return {
					toString: () => next,
				};
			},
			get: () => mockIncidentStub,
		};
		const context = {
			env: {
				...env,
				INCIDENT: mockIncidentNamespace,
			},
			var: { auth: { clientId: "client-1" } },
		} as unknown as Context<AuthContext>;
		const incidentId = await startIncident({
			c: context,
			clientId: "client-1",
			m: {
				channel: "C123",
				thread: "1712345678.000100",
			},
			identifier,
			prompt: "Investigate API latency spike",
			createdBy: "U_TEST_1",
			source: "slack",
			entryPoints: ENTRY_POINTS,
			services: SERVICES,
		});
		const secondIncidentId = await startIncident({
			c: context,
			clientId: "client-1",
			m: {
				channel: "C123",
				thread: "1712345678.000100",
			},
			identifier,
			prompt: "Investigate API latency spike again",
			createdBy: "U_TEST_1",
			source: "slack",
			entryPoints: ENTRY_POINTS,
			services: SERVICES,
		});

		expect(incidentId).not.toBe(env.INCIDENT.idFromName(identifier).toString());
		expect(secondIncidentId).not.toBe(incidentId);

		const row = await env.incidents.prepare("SELECT id, identifier, status, assignee, severity, title, description, client_id FROM incident WHERE id = ?").bind(incidentId).first<{
			id: string;
			identifier: string;
			status: string;
			assignee: string;
			severity: string;
			title: string;
			description: string;
			client_id: string;
		}>();

		expect(row).toMatchObject({
			id: incidentId,
			status: "open",
			assignee: "",
			severity: "medium",
			title: "Starting incident",
			description: "",
			client_id: "client-1",
		});
		expect(JSON.parse(row?.identifier ?? "[]")).toEqual([identifier]);
	});

	it("routes identifier-based addMessage through the indexed incident row", async () => {
		const identifier = "slack-thread:C123-1712345678.000100";
		const incidentId = env.INCIDENT.newUniqueId().toString();
		const stub = env.INCIDENT.get(env.INCIDENT.idFromString(incidentId)) as IncidentStub;

		await seedInitializedIncident({ stub, id: incidentId, identifier });
		await env.incidents
			.prepare("INSERT INTO incident (id, identifier, status, assignee, severity, title, description, client_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
			.bind(incidentId, JSON.stringify([identifier]), "open", "U_TEST_1", "medium", "Seeded incident", "Seeded for handler tests", "client-1")
			.run();

		const result = await addMessage({
			c: makeContext(),
			idOrIdentifier: { identifier, clientId: "client-1" },
			message: "Operator acknowledged",
			userId: "U_TEST_2",
			messageId: "msg-1",
			adapter: "slack",
		});

		expect(result).toBeUndefined();

		const snapshot = await stub.get();
		expect("events" in snapshot).toBe(true);
		if (!("events" in snapshot) || !snapshot.events) {
			throw new Error(`Expected incident events, got ${JSON.stringify(snapshot)}`);
		}
		const messages = snapshot.events.filter((event) => event.event_type === "MESSAGE_ADDED");
		expect(messages).toHaveLength(1);
		expect(JSON.parse(messages[0]!.event_data)).toMatchObject({
			message: "Operator acknowledged",
			userId: "U_TEST_2",
			messageId: "msg-1",
		});
	});

	it("upserts a placeholder incident row with initialized incident data", async () => {
		const incidentId = crypto.randomUUID();
		await env.incidents
			.prepare("INSERT INTO incident (id, identifier, status, assignee, severity, title, description, client_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
			.bind(incidentId, JSON.stringify(["slack-thread:C123-1712345678.000100"]), "open", "", "medium", "Starting incident", "", "client-1")
			.run();

		await dashboardSender.incidentStarted({
			step: runStep as never,
			env,
			id: incidentId,
			incident: {
				status: "open",
				assignee: "U_REAL",
				severity: "high",
				title: "API Error Spike",
				description: "High API failure rate across multiple customers.",
			},
			metadata: {
				clientId: "client-1",
				identifier: "slack-thread:C123-1712345678.000100",
			},
			sourceAdapter: "slack",
		});

		const row = await env.incidents.prepare("SELECT identifier, status, assignee, severity, title, description, client_id FROM incident WHERE id = ?").bind(incidentId).first<{
			identifier: string;
			status: string;
			assignee: string;
			severity: string;
			title: string;
			description: string;
			client_id: string;
		}>();

		expect(row).toMatchObject({
			status: "open",
			assignee: "U_REAL",
			severity: "high",
			title: "API Error Spike",
			description: "High API failure rate across multiple customers.",
			client_id: "client-1",
		});
		expect(JSON.parse(row?.identifier ?? "[]")).toEqual(["slack-thread:C123-1712345678.000100"]);
	});
});
