import { env, runInDurableObject } from "cloudflare:test";
import type { GitHubIntegrationData } from "@fire/db/schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GITHUB_COMMITS_PROVIDER_SYSTEM_PROMPT } from "../github-commits";
import { getGitHubCommitsProvider } from "./registry";

const OPENAI_URL = "https://api.openai.com/v1/responses";
const GITHUB_API = "https://api.github.com";
const STATE_KEY = "S";
const SERVICES_KEY = "SV";
const createdIncidentIds = new Set<string>();

function createProviderHandle(seed = crypto.randomUUID()) {
	const identifier = `incident:${seed}`;
	const incidentId = env.INCIDENT.idFromName(identifier).toString();
	createdIncidentIds.add(incidentId);
	const stub = getGitHubCommitsProvider(env, incidentId);
	const incidentStub = env.INCIDENT.get(env.INCIDENT.idFromString(incidentId));
	return { identifier, incidentId, stub, incidentStub };
}

function outboundUrl(input: RequestInfo | URL) {
	if (typeof input === "string") return input;
	if (input instanceof URL) return input.toString();
	return input.url;
}

const githubIntegration: GitHubIntegrationData = {
	type: "github",
	installationId: "123",
	accountLogin: "firedash",
	accountType: "Organization",
	repositories: [
		{
			owner: "firedash",
			name: "api",
			defaultBranch: "main",
			description: "Backend API and worker runtime.",
		},
	],
};

async function seedInitializedIncident(stub: ReturnType<typeof env.INCIDENT.get>, incidentId: string, identifier: string) {
	await runInDurableObject(stub, async (_instance, state) => {
		state.storage.sql.exec(`CREATE TABLE IF NOT EXISTS event_log (
			id INTEGER PRIMARY KEY,
			event_type TEXT NOT NULL,
			event_data TEXT NOT NULL CHECK (json_valid(event_data)) NOT NULL,
			event_metadata TEXT DEFAULT NULL CHECK (event_metadata IS NULL OR json_valid(event_metadata)),
			created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
			published_at TEXT DEFAULT NULL,
			attempts INTEGER NOT NULL DEFAULT 0,
			adapter TEXT NOT NULL
		);`);

		state.storage.kv.put(STATE_KEY, {
			id: incidentId,
			createdAt: new Date("2026-03-01T12:00:00.000Z"),
			status: "open",
			prompt: "Investigate 5xx errors after deploy.",
			severity: "high",
			createdBy: "user-1",
			assignee: { slackId: "U_TEST" },
			source: "slack",
			title: "API errors after deploy",
			description: "Customers report elevated 5xx errors.",
			entryPointId: "entrypoint-fallback",
			rotationId: undefined,
			teamId: undefined,
			metadata: { clientId: "client-1", identifier },
			_initialized: true,
		});
		state.storage.kv.put(SERVICES_KEY, []);
		state.storage.sql.exec(
			"INSERT INTO event_log (event_type, event_data, adapter, published_at) VALUES ('INCIDENT_CREATED', ?, 'slack', CURRENT_TIMESTAMP)",
			JSON.stringify({
				status: "open",
				severity: "high",
				createdBy: "user-1",
				title: "API errors after deploy",
				description: "Customers report elevated 5xx errors.",
				prompt: "Investigate 5xx errors after deploy.",
				source: "slack",
				entryPointId: "entrypoint-fallback",
				assignee: "U_TEST",
			}),
		);
	});
}

describe("GitHubCommitsAgent contracts", () => {
	afterEach(async () => {
		await Promise.all(
			Array.from(createdIncidentIds).map(async (incidentId) => {
				const providerStub = getGitHubCommitsProvider(env, incidentId);
				const incidentStub = env.INCIDENT.get(env.INCIDENT.idFromString(incidentId));
				await runInDurableObject(providerStub, async (_instance, state) => {
					await state.storage.deleteAlarm();
					await state.storage.deleteAll();
				});
				await runInDurableObject(incidentStub, async (_instance, state) => {
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
				content: GITHUB_COMMITS_PROVIDER_SYSTEM_PROMPT,
				source: "system",
			});
		});
	});

	it("returns null from addPrompt before addContext is called", async () => {
		const { stub } = createProviderHandle();
		const result = await stub.addPrompt({
			question: "what changed recently?",
			requestedAt: new Date().toISOString(),
		});
		expect(result).toBeNull();
	});

	it("runs the tool loop and persists a finding", async () => {
		const { identifier, incidentId, stub, incidentStub } = createProviderHandle();
		let openAiCall = 0;
		const fixedNow = 1_773_434_312_182;
		const dedupeKey = `github-prompt:${fixedNow}:firedash/api:abc123def456`;

		vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
			const url = outboundUrl(input);
			if (url === OPENAI_URL) {
				openAiCall += 1;
				if (openAiCall === 1) {
					return Response.json({
						output_text: "",
						output: [
							{
								type: "function_call",
								call_id: "call-list",
								name: "list_recent_commits",
								arguments: JSON.stringify({ repositories: ["firedash/api"], since: null, limitPerRepo: 10 }),
							},
						],
					});
				}
				if (openAiCall === 2) {
					return Response.json({
						output_text: "",
						output: [
							{
								type: "function_call",
								call_id: "call-inspect",
								name: "inspect_commit",
								arguments: JSON.stringify({ repo: "firedash/api", sha: "abc123def456" }),
							},
						],
					});
				}
				if (openAiCall === 3) {
					return Response.json({
						output_text: "",
						output: [
							{
								type: "function_call",
								call_id: "call-persist",
								name: "persist_finding",
								arguments: JSON.stringify({
									repo: "firedash/api",
									sha: "abc123def456",
									url: "https://github.com/firedash/api/commit/abc123def456",
									author: "alice",
									committedAt: "2026-03-01T11:55:00.000Z",
									title: "Rollback retry guard",
									summary: "Adds a retry guard to the deploy rollback path.",
									relevance: "This touched the rollback logic immediately before the incident started.",
								}),
							},
						],
					});
				}
				return Response.json({
					output_text: "Most relevant recent change is `Rollback retry guard` in `firedash/api`.",
					output: [],
				});
			}

			if (url === `${GITHUB_API}/app/installations/123/access_tokens`) {
				return Response.json({ token: "ghs_test_token" });
			}

			if (url.startsWith(`${GITHUB_API}/repos/firedash/api/commits?`)) {
				return Response.json([
					{
						sha: "abc123def456",
						html_url: "https://github.com/firedash/api/commit/abc123def456",
						commit: {
							message: "Rollback retry guard\n\nExtra details",
							author: { name: "Alice", date: "2026-03-01T11:55:00.000Z" },
						},
						author: { login: "alice" },
					},
				]);
			}

			if (url === `${GITHUB_API}/repos/firedash/api/commits/abc123def456`) {
				return Response.json({
					sha: "abc123def456",
					html_url: "https://github.com/firedash/api/commit/abc123def456",
					commit: {
						message: "Rollback retry guard\n\nExtra details",
						author: { name: "Alice", date: "2026-03-01T11:55:00.000Z" },
					},
					author: { login: "alice" },
					files: [
						{
							filename: "src/rollback.ts",
							status: "modified",
							additions: 12,
							deletions: 3,
							patch: "@@ -1,3 +1,12 @@\n+retry guard",
						},
					],
				});
			}

			throw new Error(`Unexpected outbound fetch in tests: ${url}`);
		});

		await seedInitializedIncident(incidentStub, incidentId, identifier);
		vi.spyOn(Date, "now").mockReturnValue(fixedNow);
		await runInDurableObject(incidentStub, async (_instance, state) => {
			state.storage.sql.exec(
				"INSERT INTO event_log (event_type, event_data, event_metadata, adapter, published_at) VALUES ('GITHUB_COMMIT', ?, ?, 'fire', CURRENT_TIMESTAMP)",
				JSON.stringify({
					originRunId: `github-prompt:${fixedNow}`,
					repo: "firedash/api",
					sha: "abc123def456",
					url: "https://github.com/firedash/api/commit/abc123def456",
					author: "alice",
					committedAt: "2026-03-01T11:55:00.000Z",
					title: "Rollback retry guard",
					summary: "Adds a retry guard to the deploy rollback path.",
					relevance: "This touched the rollback logic immediately before the incident started.",
				}),
				JSON.stringify({ agentDedupeKey: dedupeKey }),
			);
		});

		await stub.addContext({
			incidentId,
			toEventId: 0,
			events: [],
			trigger: "agent-turn",
			requestedAt: new Date().toISOString(),
		});

		const result = await runInDurableObject(stub, async (instance, state) => {
			state.storage.kv.put("githubContextLoaded", true);
			state.storage.kv.put("githubIntegration", githubIntegration);
			return await instance.addPrompt({
				question: "What recent commit looks most suspicious?",
				requestedAt: new Date().toISOString(),
			});
		});

		expect(result?.answer).toContain("Rollback retry guard");

		await runInDurableObject(stub, async (_instance, state) => {
			const steps = state.storage.sql.exec<{ role: string; name: string | null; source: string }>("SELECT role, name, source FROM steps ORDER BY id ASC").toArray();
			expect(steps.some((step) => step.role === "function_call" && step.name === "list_recent_commits")).toBe(true);
			expect(steps.some((step) => step.role === "function_call" && step.name === "inspect_commit")).toBe(true);
			expect(steps.some((step) => step.role === "function_call" && step.name === "persist_finding")).toBe(true);
			expect(steps.some((step) => step.role === "tool")).toBe(true);
		});
	});

	it("returns plain text when no relevant commit is found", async () => {
		const { identifier, incidentId, stub, incidentStub } = createProviderHandle();

		vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
			const url = outboundUrl(input);
			if (url === OPENAI_URL) {
				return Response.json({
					output_text: "No recent GitHub commit stands out as a likely cause from the available evidence.",
					output: [],
				});
			}
			throw new Error(`Unexpected outbound fetch in tests: ${url}`);
		});

		await seedInitializedIncident(incidentStub, incidentId, identifier);

		await stub.addContext({
			incidentId,
			toEventId: 0,
			events: [],
			trigger: "agent-turn",
			requestedAt: new Date().toISOString(),
		});

		const result = await runInDurableObject(stub, async (instance, state) => {
			state.storage.kv.put("githubContextLoaded", true);
			state.storage.kv.put("githubIntegration", githubIntegration);
			return await instance.addPrompt({
				question: "Any commit look relevant?",
				requestedAt: new Date().toISOString(),
			});
		});

		expect(result?.answer).toContain("No recent GitHub commit");
	});
});
