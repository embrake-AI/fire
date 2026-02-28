import { env, listDurableObjectIds, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type IncidentStub = DurableObjectStub<import("./incident").Incident>;
type DispatchResult = { calls: Array<{ eventType: string; payload: unknown }>; error: string | null };

const ENTRY_POINTS = [
	{
		id: "entrypoint-api",
		prompt: "API failures and outages",
		assignee: { id: "user-1", slackId: "U_TEST_1" },
		isFallback: false,
		rotationId: "rotation-api",
		teamId: "team-api",
	},
	{
		id: "entrypoint-fallback",
		prompt: "Fallback for all unmatched incidents",
		assignee: { id: "user-1", slackId: "U_TEST_1" },
		isFallback: true,
		rotationId: undefined,
		teamId: undefined,
	},
];

const SERVICES = [
	{ id: "svc-api", name: "API", prompt: "Public API availability" },
	{ id: "svc-web", name: "Web", prompt: "Dashboard availability" },
];

const OPENAI_URL = "https://api.openai.com/v1/responses";

function createIncidentHandle(seed = crypto.randomUUID()) {
	const identifier = `incident:${seed}`;
	const doId = env.INCIDENT.idFromName(identifier);
	const stub = env.INCIDENT.get(doId);
	return { identifier, id: doId.toString(), stub };
}

async function startIncident(stub: IncidentStub, id: string, identifier: string) {
	await startIncidentWithData(stub, id, identifier, {
		services: SERVICES,
	});
}

async function startIncidentWithData(
	stub: IncidentStub,
	id: string,
	identifier: string,
	options: {
		services: Array<{ id: string; name: string; prompt: string | null }>;
		bootstrapMessages?: Array<{ message: string; userId: string; messageId: string; createdAt: string }>;
	},
) {
	await runInDurableObject(stub, async (instance, state) => {
		const incident = instance as import("./incident").Incident;
		await incident.start(
			{
				id,
				prompt: "Users report elevated API error rates and latency",
				createdBy: "user-1",
				source: "dashboard",
				metadata: { clientId: "client-1", identifier },
			},
			ENTRY_POINTS,
			options.services,
			options.bootstrapMessages,
		);
		// Keep tests deterministic: disable the immediate alarm created by start().
		await state.storage.deleteAlarm();
	});
}

function outboundUrl(input: RequestInfo | URL) {
	if (typeof input === "string") {
		return input;
	}
	if (input instanceof URL) {
		return input.toString();
	}
	return input.url;
}

function mockOpenAiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	const url = outboundUrl(input);
	if (url !== OPENAI_URL) {
		throw new Error(`Unexpected outbound fetch in tests: ${url}`);
	}

	let requestBody: Record<string, unknown> = {};
	if (typeof init?.body === "string") {
		requestBody = JSON.parse(init.body) as Record<string, unknown>;
	}

	const schemaName =
		(requestBody.text as { format?: { name?: string } } | undefined)?.format?.name ??
		(requestBody.response_format as { json_schema?: { name?: string } } | undefined)?.json_schema?.name;
	if (schemaName === "incident_info") {
		return Promise.resolve(
			Response.json({
				output_text: JSON.stringify({
					entryPointIndex: 0,
					severity: "high",
					title: "API Error Spike",
					description: "High API failure rate across multiple customers.",
				}),
				output: [],
			}),
		);
	}

	if (schemaName === "incident_postmortem") {
		return Promise.resolve(
			Response.json({
				output_text: JSON.stringify({
					timeline: [{ created_at: new Date().toISOString(), text: "Incident identified and triaged." }],
					rootCause: "Root cause not determined from available data.",
					impact: "Elevated error rates and latency for API users.",
					actions: ["Review API error budget alerts"],
				}),
				output: [],
			}),
		);
	}

	return Promise.resolve(
		Response.json({
			output_text: "Acknowledged.",
			output: [],
		}),
	);
}

function parseEventData<T>(event: { event_data: string }) {
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

async function runAlarmWithDispatchSpy(stub: IncidentStub, options: { failures?: number; stubAnalysis?: boolean } = {}): Promise<DispatchResult> {
	return runInDurableObject(stub, async (instance) => {
		const incident = instance as import("./incident").Incident;
		let remainingFailures = options.failures ?? 0;
		const calls: Array<{ eventType: string; payload: unknown }> = [];

		(instance as { dispatchToWorkflow?: (event: { event_type: string }, state: unknown) => Promise<void> }).dispatchToWorkflow = async (event, state) => {
			const payload = (instance as { buildWorkflowPayload?: (event: unknown, state: unknown) => unknown }).buildWorkflowPayload?.(event, state);
			calls.push({ eventType: event.event_type, payload });

			if (remainingFailures > 0) {
				remainingFailures -= 1;
				throw new Error("dispatch failure");
			}
		};

		if (options.stubAnalysis) {
			(instance as { startAnalysisWorkflow?: () => Promise<void> }).startAnalysisWorkflow = async () => {};
		}

		try {
			await incident.alarm();
			return { calls, error: null };
		} catch (error) {
			return { calls, error: error instanceof Error ? error.message : String(error) };
		}
	});
}

async function disableAutoAlarmScheduling(stub: IncidentStub) {
	await runInDurableObject(stub, async (instance, state) => {
		(instance as { scheduleAlarmAtMost?: (time: number) => Promise<void> }).scheduleAlarmAtMost = async () => {};
		await state.storage.deleteAlarm();
	});
}

async function setAgentState(stub: IncidentStub, nextState: { lastProcessedEventId: number; toEventId: number | null; nextAt?: number }) {
	await runInDurableObject(stub, async (_instance, state) => {
		state.storage.kv.put("AG", nextState);
	});
}

describe("Incident e2e contract", () => {
	beforeEach(() => {
		vi.stubGlobal("fetch", mockOpenAiFetch);
	});

	afterEach(async () => {
		const ids = await listDurableObjectIds(env.INCIDENT);
		await Promise.all(
			ids.map(async (id) => {
				const stub = env.INCIDENT.get(id);
				await runInDurableObject(stub, async (_instance, state) => {
					await state.storage.deleteAlarm();
					await state.storage.deleteAll();
				});
			}),
		);
		vi.unstubAllGlobals();
	});

	it("rejects start when entry points are empty and persists nothing", async () => {
		const { stub, id, identifier } = createIncidentHandle();
		await runInDurableObject(stub, async (incident) => {
			await expect(
				incident.start(
					{
						id,
						prompt: "Users report elevated API error rates and latency",
						createdBy: "user-1",
						source: "dashboard",
						metadata: { clientId: "client-1", identifier },
					},
					[],
					SERVICES,
				),
			).rejects.toThrow("At least one entry point is required");
		});

		expect(await stub.get()).toEqual({ error: "NOT_FOUND" });
	});

	it("initializes from start() and dispatches INCIDENT_CREATED payload via alarm", async () => {
		const { stub, id, identifier } = createIncidentHandle();
		await startIncident(stub, id, identifier);

		expect(await stub.get()).toEqual({ error: "INITIALIZING" });

		const alarmResult = await runAlarmWithDispatchSpy(stub);
		expect(alarmResult.error).toBeNull();
		expect(alarmResult.calls).toHaveLength(1);
		expect(alarmResult.calls[0]?.eventType).toBe("INCIDENT_CREATED");

		const payload = alarmResult.calls[0]?.payload as { kind?: string; event?: { event_type?: string }; incident?: { status?: string; severity?: string } };
		expect(payload.kind).toBe("event");
		expect(payload.event?.event_type).toBe("INCIDENT_CREATED");
		expect(payload.incident?.status).toBe("open");
		expect(payload.incident?.severity).toBe("high");

		const result = assertReady(await stub.get());
		expect(result.state.title).toBe("API Error Spike");
		expect(result.state.status).toBe("open");
		expect(result.events).toHaveLength(1);
		expect(result.events[0]?.event_type).toBe("INCIDENT_CREATED");
		expect(result.events[0]?.published_at).not.toBeNull();
	});

	it("normalizes startup services and bootstrap messages before init", async () => {
		const { stub, id, identifier } = createIncidentHandle();
		await startIncidentWithData(stub, id, identifier, {
			services: [
				{ id: "svc-api", name: "API", prompt: "Primary API checks" },
				{ id: "", name: "No id", prompt: null },
				{ id: "svc-api", name: "API duplicate", prompt: "Ignored duplicate" },
				{ id: "svc-web", name: "Web", prompt: null },
				{ id: "svc-empty-name", name: "", prompt: null },
			],
			bootstrapMessages: [
				{ message: "duplicate later", userId: "U_1", messageId: "m-dup", createdAt: "2026-01-03T00:00:00.000Z" },
				{ message: "earliest duplicate kept", userId: "U_2", messageId: "m-dup", createdAt: "2026-01-01T00:00:00.000Z" },
				{ message: "invalid date dropped", userId: "U_3", messageId: "m-invalid", createdAt: "not-a-date" },
				{ message: "middle message", userId: "U_4", messageId: "m-mid", createdAt: "2026-01-02T00:00:00.000Z" },
			],
		});

		const alarmResult = await runAlarmWithDispatchSpy(stub);
		expect(alarmResult.error).toBeNull();
		expect(alarmResult.calls.map((call) => call.eventType)).toEqual(["INCIDENT_CREATED"]);

		const result = assertReady(await stub.get());
		expect(result.events.map((event) => event.event_type)).toEqual(["MESSAGE_ADDED", "MESSAGE_ADDED", "INCIDENT_CREATED"]);

		const bootstrapEvents = result.events.filter((event) => event.event_type === "MESSAGE_ADDED");
		expect(bootstrapEvents).toHaveLength(2);
		expect(bootstrapEvents.every((event) => event.published_at !== null)).toBe(true);
		expect(bootstrapEvents.map((event) => parseEventData<{ messageId: string }>(event).messageId)).toEqual(["m-dup", "m-mid"]);
		expect(parseEventData<{ message: string }>(bootstrapEvents[0]!).message).toBe("earliest duplicate kept");

		const agentContext = await stub.getAgentContext();
		expect("services" in agentContext).toBe(true);
		if (!("services" in agentContext)) {
			throw new Error(`Expected initialized agent context, got: ${JSON.stringify(agentContext)}`);
		}
		expect(agentContext.services).toEqual([
			{ id: "svc-api", name: "API", prompt: "Primary API checks" },
			{ id: "svc-web", name: "Web", prompt: null },
		]);
	});

	it("keeps accepted updates unpublished until alarm and dispatches them in order", async () => {
		const { stub, id, identifier } = createIncidentHandle();
		await startIncident(stub, id, identifier);
		await disableAutoAlarmScheduling(stub);
		await runAlarmWithDispatchSpy(stub);

		await stub.setSeverity("low", "dashboard");
		await stub.setAssignee({ slackId: "U_TEST_2" }, "dashboard");
		await stub.addMessage("Operator acknowledged", "U_TEST_2", "msg-ordered-1", "dashboard");
		await stub.updateStatus("mitigating", "Mitigation in progress", "dashboard");

		const beforeAlarm = assertReady(await stub.get());
		const unpublishedTail = beforeAlarm.events.slice(-4);
		expect(unpublishedTail.map((event) => event.event_type)).toEqual(["SEVERITY_UPDATE", "ASSIGNEE_UPDATE", "MESSAGE_ADDED", "STATUS_UPDATE"]);
		expect(unpublishedTail.every((event) => event.published_at === null)).toBe(true);

		const alarmResult = await runAlarmWithDispatchSpy(stub);
		expect(alarmResult.error).toBeNull();
		expect(alarmResult.calls.map((call) => call.eventType)).toEqual(["SEVERITY_UPDATE", "ASSIGNEE_UPDATE", "MESSAGE_ADDED", "STATUS_UPDATE"]);

		const afterAlarm = assertReady(await stub.get());
		const publishedTail = afterAlarm.events.slice(-4);
		expect(publishedTail.every((event) => event.published_at !== null)).toBe(true);
	});

	it("does not append events for no-op state updates", async () => {
		const { stub, id, identifier } = createIncidentHandle();
		await startIncident(stub, id, identifier);
		await disableAutoAlarmScheduling(stub);
		await runAlarmWithDispatchSpy(stub);

		const beforeNoops = assertReady(await stub.get());
		const beforeCount = beforeNoops.events.length;

		await stub.setSeverity("high", "dashboard");
		await stub.setAssignee({ slackId: "U_TEST_1" }, "dashboard");
		await stub.updateStatus("open", "No status change", "dashboard");

		const afterNoops = assertReady(await stub.get());
		expect(afterNoops.events).toHaveLength(beforeCount);

		const alarmResult = await runAlarmWithDispatchSpy(stub);
		expect(alarmResult.error).toBeNull();
		expect(alarmResult.calls).toHaveLength(0);
	});

	it("retries unpublished events when dispatch fails and preserves attempts", async () => {
		const { stub, id, identifier } = createIncidentHandle();
		await startIncident(stub, id, identifier);
		await disableAutoAlarmScheduling(stub);
		await runAlarmWithDispatchSpy(stub);

		await stub.setSeverity("low", "dashboard");

		const firstAlarm = await runAlarmWithDispatchSpy(stub, { failures: 1 });
		expect(firstAlarm.error).toContain("dispatch failure");
		expect(firstAlarm.calls).toHaveLength(1);

		const afterFailure = assertReady(await stub.get());
		const severityEventAfterFailure = afterFailure.events.find((event) => event.event_type === "SEVERITY_UPDATE");
		expect(severityEventAfterFailure?.attempts).toBe(1);
		expect(severityEventAfterFailure?.published_at).toBeNull();

		const secondAlarm = await runAlarmWithDispatchSpy(stub);
		expect(secondAlarm.error).toBeNull();
		expect(secondAlarm.calls.map((call) => call.eventType)).toEqual(["SEVERITY_UPDATE"]);

		const afterSuccess = assertReady(await stub.get());
		const severityEventAfterSuccess = afterSuccess.events.find((event) => event.event_type === "SEVERITY_UPDATE");
		expect(severityEventAfterSuccess?.attempts).toBe(1);
		expect(severityEventAfterSuccess?.published_at).not.toBeNull();
	});

	it("stops retrying events after MAX_ATTEMPTS", async () => {
		const { stub, id, identifier } = createIncidentHandle();
		await startIncident(stub, id, identifier);
		await disableAutoAlarmScheduling(stub);
		await runAlarmWithDispatchSpy(stub);

		await stub.setSeverity("low", "dashboard");

		for (let attempt = 1; attempt <= 3; attempt++) {
			const alarm = await runAlarmWithDispatchSpy(stub, { failures: 1 });
			expect(alarm.error).toContain("dispatch failure");
			expect(alarm.calls).toHaveLength(1);
		}

		const afterMaxAttempts = assertReady(await stub.get());
		const stuckEvent = afterMaxAttempts.events.find((event) => event.event_type === "SEVERITY_UPDATE");
		expect(stuckEvent?.attempts).toBe(3);
		expect(stuckEvent?.published_at).toBeNull();

		const nextAlarm = await runAlarmWithDispatchSpy(stub);
		expect(nextAlarm.error).toBeNull();
		expect(nextAlarm.calls).toHaveLength(0);
	});

	it("returns all expected validation errors before first affection update", async () => {
		const { stub, id, identifier } = createIncidentHandle();
		await startIncident(stub, id, identifier);
		await disableAutoAlarmScheduling(stub);
		await runAlarmWithDispatchSpy(stub);

		const missingMessage = await stub.updateAffection({
			message: "   ",
			title: "API degradation",
			status: "investigating",
			services: [{ id: "svc-api", impact: "major" }],
			createdBy: "user-1",
			adapter: "dashboard",
		});
		expect(missingMessage).toEqual({ error: "MESSAGE_REQUIRED" });

		const missingTitle = await stub.updateAffection({
			message: "Public update",
			status: "investigating",
			services: [{ id: "svc-api", impact: "major" }],
			createdBy: "user-1",
			adapter: "dashboard",
		});
		expect(missingTitle).toEqual({ error: "TITLE_REQUIRED" });

		const missingServices = await stub.updateAffection({
			message: "Public update",
			title: "API degradation",
			status: "investigating",
			services: [{ id: "svc-unknown", impact: "major" }],
			createdBy: "user-1",
			adapter: "dashboard",
		});
		expect(missingServices).toEqual({ error: "SERVICES_REQUIRED" });

		const missingInitialStatus = await stub.updateAffection({
			message: "Public update",
			title: "API degradation",
			services: [{ id: "svc-api", impact: "major" }],
			createdBy: "user-1",
			adapter: "dashboard",
		});
		expect(missingInitialStatus).toEqual({ error: "INITIAL_STATUS_REQUIRED" });

		const afterFailures = assertReady(await stub.get());
		const affectionEvents = afterFailures.events.filter((event) => event.event_type === "AFFECTION_UPDATE");
		expect(affectionEvents).toHaveLength(0);
	});

	it("validates affection creation and dispatches filtered service payload", async () => {
		const { stub, id, identifier } = createIncidentHandle();
		await startIncident(stub, id, identifier);
		await disableAutoAlarmScheduling(stub);
		await runAlarmWithDispatchSpy(stub);

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

		const beforeAlarm = assertReady(await stub.get());
		const affectionEventBeforeAlarm = beforeAlarm.events.find((event) => event.event_type === "AFFECTION_UPDATE");
		expect(affectionEventBeforeAlarm?.published_at).toBeNull();
		expect(parseEventData<{ services?: Array<{ id: string; impact: string }> }>(affectionEventBeforeAlarm!).services).toEqual([{ id: "svc-api", impact: "major" }]);

		const alarmResult = await runAlarmWithDispatchSpy(stub);
		expect(alarmResult.error).toBeNull();
		const affectionDispatch = alarmResult.calls.find((call) => call.eventType === "AFFECTION_UPDATE");
		expect(affectionDispatch).toBeTruthy();
		const affectionPayload = affectionDispatch?.payload as {
			event?: {
				event_data?: { services?: Array<{ id: string; impact: string }> };
			};
		};
		expect(affectionPayload.event?.event_data?.services).toEqual([{ id: "svc-api", impact: "major" }]);
	});

	it("enforces terminal lock after decline and dispatches declined status payload", async () => {
		const { stub, id, identifier } = createIncidentHandle();
		await startIncident(stub, id, identifier);
		await disableAutoAlarmScheduling(stub);
		await runAlarmWithDispatchSpy(stub);

		await stub.updateStatus("declined", "False positive", "dashboard");

		const blockedSeverity = await stub.setSeverity("low", "dashboard");
		expect(blockedSeverity).toEqual({ error: "RESOLVED" });

		const blockedMessage = await stub.addMessage("Should be rejected", "U_TEST_2", "msg-after-decline", "dashboard");
		expect(blockedMessage).toEqual({ error: "RESOLVED" });

		const alarmResult = await runAlarmWithDispatchSpy(stub);
		expect(alarmResult.error).toBeNull();
		expect(alarmResult.calls.map((call) => call.eventType)).toEqual(["STATUS_UPDATE"]);

		const statusPayload = alarmResult.calls[0]?.payload as {
			event?: { event_data?: { status?: string; message?: string } };
		};
		expect(statusPayload.event?.event_data?.status).toBe("declined");
		expect(statusPayload.event?.event_data?.message).toBe("False positive");

		const result = assertReady(await stub.get());
		expect(result.state.status).toBe("declined");
		const statusEvents = result.events.filter((event) => event.event_type === "STATUS_UPDATE");
		expect(statusEvents).toHaveLength(1);
	});

	it("destroys terminal incidents on the next alarm once outbox is empty", async () => {
		const { stub, id, identifier } = createIncidentHandle();
		await startIncident(stub, id, identifier);
		await disableAutoAlarmScheduling(stub);
		await runAlarmWithDispatchSpy(stub);

		await stub.updateStatus("declined", "False positive", "dashboard");

		const firstAlarm = await runAlarmWithDispatchSpy(stub);
		expect(firstAlarm.error).toBeNull();
		expect(firstAlarm.calls.map((call) => call.eventType)).toEqual(["STATUS_UPDATE"]);

		const stillPresent = await stub.get();
		expect("state" in stillPresent).toBe(true);

		await setAgentState(stub, { lastProcessedEventId: Number.MAX_SAFE_INTEGER, toEventId: null });
		const cleanupAlarm = await runAlarmWithDispatchSpy(stub, { stubAnalysis: true });
		expect(cleanupAlarm.error).toBeNull();
		expect(cleanupAlarm.calls).toHaveLength(0);

		expect(await stub.get()).toEqual({ error: "NOT_FOUND" });
	});

	it("adds sanitized suggestions as published fire messages without duplicates", async () => {
		const { stub, id, identifier } = createIncidentHandle();
		await startIncident(stub, id, identifier);
		await disableAutoAlarmScheduling(stub);
		await runAlarmWithDispatchSpy(stub);

		await stub.addMessage("Existing message", "U_TEST_1", "msg-existing", "dashboard");
		await stub.addSuggestions([
			{ message: "   ", suggestionId: "s-invalid-empty", messageId: "m-invalid-empty" },
			{
				message: "Apply mitigating status",
				suggestionId: "s-valid-1",
				messageId: "m-new-1",
				suggestion: { action: "update_status", status: "mitigating", message: "Mitigation in progress" },
			},
			{ message: "Duplicate in same batch", suggestionId: "s-dup", messageId: "m-new-1" },
			{ message: "Should be skipped because existing", suggestionId: "s-existing", messageId: "msg-existing" },
			{ message: "  Another valid  ", suggestionId: "s-valid-2", messageId: "m-new-2" },
			{ message: "Valid without suggestion body", suggestionId: "s-valid-3", messageId: "m-new-3" },
		]);

		const messageRows = await runInDurableObject(stub, async (_instance, state) => {
			return state.storage.sql
				.exec<{
					event_data: string;
					event_metadata: string | null;
					adapter: string;
					published_at: string | null;
				}>("SELECT event_data, event_metadata, adapter, published_at FROM event_log WHERE event_type = 'MESSAGE_ADDED' ORDER BY id ASC")
				.toArray();
		});

		const fireSuggestionRows = messageRows.filter((row) => row.adapter === "fire");
		expect(fireSuggestionRows).toHaveLength(3);
		expect(fireSuggestionRows.every((row) => row.published_at !== null)).toBe(true);

		const normalizedFireSuggestions = fireSuggestionRows.map((row) => ({
			data: JSON.parse(row.event_data) as { message: string; messageId: string },
			metadata: row.event_metadata ? (JSON.parse(row.event_metadata) as { kind?: string; agentSuggestionId?: string }) : null,
		}));

		expect(normalizedFireSuggestions.map((row) => row.data.messageId)).toEqual(["m-new-1", "m-new-2", "m-new-3"]);
		expect(normalizedFireSuggestions[1]?.data.message).toBe("Another valid");
		expect(normalizedFireSuggestions[0]?.metadata).toEqual({ kind: "suggestion", agentSuggestionId: "s-valid-1" });
		expect(normalizedFireSuggestions[1]?.metadata).toEqual({ kind: "suggestion", agentSuggestionId: "s-valid-2" });
		expect(normalizedFireSuggestions[2]?.metadata).toEqual({ kind: "suggestion", agentSuggestionId: "s-valid-3" });

		const result = assertReady(await stub.get());
		const messageIds = result.events.filter((event) => event.event_type === "MESSAGE_ADDED").map((event) => parseEventData<{ messageId: string }>(event).messageId);
		expect(messageIds.filter((messageId) => messageId === "m-new-1")).toHaveLength(1);
		expect(messageIds).toContain("msg-existing");
	});

	it("merges metadata additively without appending events", async () => {
		const { stub, id, identifier } = createIncidentHandle();
		await startIncident(stub, id, identifier);
		await disableAutoAlarmScheduling(stub);
		await runAlarmWithDispatchSpy(stub);

		const before = assertReady(await stub.get());
		const beforeCount = before.events.length;

		const firstMerge = await stub.addMetadata({ channel: "C_TEST", thread: "1711.22", region: "us-east-1" });
		expect(firstMerge).not.toEqual({ error: "NOT_FOUND" });
		expect(firstMerge).not.toEqual({ error: "NOT_INITIALIZED" });
		expect(firstMerge).not.toEqual({ error: "RESOLVED" });

		const secondMerge = await stub.addMetadata({ region: "eu-west-1", correlationId: "corr-1" });
		expect(secondMerge).not.toEqual({ error: "NOT_FOUND" });
		expect(secondMerge).not.toEqual({ error: "NOT_INITIALIZED" });
		expect(secondMerge).not.toEqual({ error: "RESOLVED" });

		const after = assertReady(await stub.get());
		expect(after.events).toHaveLength(beforeCount);
		expect(after.context).toEqual({ channel: "C_TEST", thread: "1711.22" });

		const agentContext = await stub.getAgentContext();
		expect("metadata" in agentContext).toBe(true);
		if (!("metadata" in agentContext)) {
			throw new Error(`Expected initialized agent context, got: ${JSON.stringify(agentContext)}`);
		}
		expect(agentContext.metadata).toMatchObject({
			clientId: "client-1",
			identifier,
			channel: "C_TEST",
			thread: "1711.22",
			region: "eu-west-1",
			correlationId: "corr-1",
		});

		const alarmResult = await runAlarmWithDispatchSpy(stub);
		expect(alarmResult.error).toBeNull();
		expect(alarmResult.calls).toHaveLength(0);
	});

	it("treats repeated start as a no-op for existing incidents", async () => {
		const { stub, id, identifier } = createIncidentHandle();
		await startIncident(stub, id, identifier);
		await disableAutoAlarmScheduling(stub);
		await runAlarmWithDispatchSpy(stub);

		const before = assertReady(await stub.get());
		const beforeEventCount = before.events.length;
		const beforePrompt = before.state.prompt;
		const beforeCreatedBy = before.state.createdBy;
		const beforeSource = before.state.source;

		const beforeAgentContext = await stub.getAgentContext();
		expect("services" in beforeAgentContext).toBe(true);
		if (!("services" in beforeAgentContext)) {
			throw new Error(`Expected initialized agent context, got: ${JSON.stringify(beforeAgentContext)}`);
		}

		await runInDurableObject(stub, async (instance) => {
			const incident = instance as import("./incident").Incident;
			await incident.start(
				{
					id: `${id}-different`,
					prompt: "Different prompt that should be ignored",
					createdBy: "user-2",
					source: "slack",
					metadata: { clientId: "client-overwrite", identifier: "incident:overwrite", channel: "C_OTHER", thread: "T_OTHER" },
				},
				[
					{
						id: "entrypoint-other",
						prompt: "Other entrypoint",
						assignee: { id: "user-2", slackId: "U_OTHER" },
						isFallback: true,
						rotationId: undefined,
						teamId: undefined,
					},
				],
				[{ id: "svc-other", name: "Other Service", prompt: "Other prompt" }],
				[{ message: "bootstrap that should not be inserted", userId: "U_OTHER", messageId: "boot-other-1", createdAt: "2026-01-01T00:00:00.000Z" }],
			);
		});

		const after = assertReady(await stub.get());
		expect(after.events).toHaveLength(beforeEventCount);
		expect(after.state.prompt).toBe(beforePrompt);
		expect(after.state.createdBy).toBe(beforeCreatedBy);
		expect(after.state.source).toBe(beforeSource);
		expect(after.events.some((event) => parseEventData<{ messageId?: string }>(event).messageId === "boot-other-1")).toBe(false);

		const afterAgentContext = await stub.getAgentContext();
		expect("services" in afterAgentContext).toBe(true);
		if (!("services" in afterAgentContext)) {
			throw new Error(`Expected initialized agent context, got: ${JSON.stringify(afterAgentContext)}`);
		}
		expect(afterAgentContext.services).toEqual(beforeAgentContext.services);
		expect(afterAgentContext.metadata).toBeDefined();
		if (!afterAgentContext.metadata) {
			throw new Error("Expected agent context metadata");
		}
		expect(afterAgentContext.metadata.clientId).toBe("client-1");
		expect(afterAgentContext.metadata.identifier).toBe(identifier);

		const alarmResult = await runAlarmWithDispatchSpy(stub);
		expect(alarmResult.error).toBeNull();
		expect(alarmResult.calls).toHaveLength(0);
	});
});
