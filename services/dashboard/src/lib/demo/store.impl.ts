import type { IS, IS_Event, ListIncidentsElement } from "@fire/common";
import type { createEntryPoint, createEntryPointFromSlackUser, getEntryPoints, updateEntryPointPrompt } from "../entry-points/entry-points";
import type { AffectionImpact, AffectionStatus, IncidentAffectionData } from "../incident-affections/incident-affections";
import type { getAnalysisById, getMetrics, IncidentAction, IncidentEvent, ResolvedIncident } from "../incidents/incidents";
import type { SlackChannel, SlackSelectableChannel, SlackUser } from "../slack";
import type { verifyCustomDomain } from "../status-pages/status-pages";
import { readKV, writeKV } from "./idb";

const STATE_KEY = "demo-state-v1";
const MAX_RESOLVED_INCIDENTS = 50;

type GetEntryPointsResponse = Awaited<ReturnType<typeof getEntryPoints>>;
type CreateEntryPointResponse = Awaited<ReturnType<typeof createEntryPoint>>;
type CreateEntryPointFromSlackUserResponse = Awaited<ReturnType<typeof createEntryPointFromSlackUser>>;
type UpdateEntryPointPromptResponse = Awaited<ReturnType<typeof updateEntryPointPrompt>>;
type VerifyCustomDomainResponse = Awaited<ReturnType<typeof verifyCustomDomain>>;
type GetAnalysisByIdResponse = Awaited<ReturnType<typeof getAnalysisById>>;
type GetMetricsResponse = Awaited<ReturnType<typeof getMetrics>>;

type WorkspacePlatform = "slack" | "notion" | "intercom";
type UserPlatform = "slack";
type DemoUserRole = "VIEWER" | "MEMBER" | "ADMIN" | "SUPER_ADMIN";
type ManageableUserRole = Exclude<DemoUserRole, "SUPER_ADMIN">;
type DemoTeamMembershipRole = "MEMBER" | "ADMIN";

type DemoClient = {
	id: string;
	name: string;
	image: string | null;
	domains: string[];
	defaultUserRole: ManageableUserRole;
	autoCreateUsersWithSso: boolean;
};

type DemoUser = {
	id: string;
	name: string;
	email: string;
	image: string | null;
	teams: { id: string; role: DemoTeamMembershipRole }[];
	slackId: string | null;
	role: DemoUserRole;
};

type DemoTeam = {
	id: string;
	name: string;
	imageUrl: string | null;
	createdAt: Date;
};

type DemoService = {
	id: string;
	name: string;
	description: string | null;
	prompt: string | null;
	imageUrl: string | null;
	createdAt: Date;
	updatedAt: Date;
	teamOwnerIds: string[];
	userOwnerIds: string[];
	affectsServiceIds: string[];
	affectedByServiceIds: string[];
};

type DemoRotation = {
	id: string;
	name: string;
	slackChannelId: string | null;
	shiftStart: Date | null;
	shiftLength: string;
	assigneeIds: string[];
	createdAt: Date;
	teamId: string | null;
};

type DemoRotationOverride = {
	id: string;
	rotationId: string;
	assigneeId: string;
	startAt: Date;
	endAt: Date;
	createdAt: Date;
};

type DemoEntryPoint = {
	id: string;
	type: "user" | "rotation";
	prompt: string;
	assigneeId?: string;
	rotationId?: string;
	isFallback: boolean;
	createdAt: Date;
};

type DemoStatusPageLink = {
	serviceId: string;
	position: number;
	description: string | null;
};

type DemoStatusPage = {
	id: string;
	name: string;
	slug: string;
	logoUrl: string | null;
	faviconUrl: string | null;
	serviceDisplayMode: string | null;
	customDomain: string | null;
	supportUrl: string | null;
	privacyPolicyUrl: string | null;
	termsOfServiceUrl: string | null;
	createdAt: Date;
	updatedAt: Date;
	services: DemoStatusPageLink[];
};

type DemoApiKey = {
	id: string;
	name: string;
	keyPrefix: string;
	createdAt: Date;
	lastUsedAt: Date | null;
};

type DemoAffectionService = {
	id: string;
	impact: AffectionImpact;
};

type DemoAffectionUpdate = {
	id: string;
	status: AffectionStatus | null;
	message: string | null;
	createdAt: Date;
	createdBy: string | null;
};

type DemoAffection = {
	id: string;
	incidentId: string;
	title: string;
	createdAt: Date;
	updatedAt: Date;
	resolvedAt: Date | null;
	services: DemoAffectionService[];
	updates: DemoAffectionUpdate[];
};

type DemoIncident = {
	id: string;
	state: IS;
	context: {
		channel?: string;
		thread?: string;
	};
	events: IncidentEvent[];
};

type DemoAnalysis = {
	id: string;
	clientId: string;
	title: string;
	description: string;
	severity: IS["severity"];
	assignee: string;
	createdBy: string;
	source: "slack" | "dashboard";
	prompt: string;
	createdAt: Date;
	resolvedAt: Date | null;
	events: IncidentEvent[];
	timeline: { created_at: string; text: string }[] | null;
	impact: string | null;
	rootCause: string | null;
	actions: IncidentAction[];
	entryPointId: string | null;
	rotationId: string | null;
	teamId: string | null;
	notionPageId: string | null;
};

type DemoNotionPage = {
	id: string;
	title: string;
	icon: string | null;
};

type DemoIntegrationRow<T extends string> = {
	platform: T;
	installedAt: Date | null;
};

type DemoState = {
	version: 1;
	client: DemoClient;
	currentUserId: string;
	users: DemoUser[];
	teams: DemoTeam[];
	services: DemoService[];
	rotations: DemoRotation[];
	rotationOverrides: DemoRotationOverride[];
	entryPoints: DemoEntryPoint[];
	statusPages: DemoStatusPage[];
	apiKeys: DemoApiKey[];
	workspaceIntegrations: DemoIntegrationRow<WorkspacePlatform>[];
	intercomStatusPageId: string | null;
	userIntegrations: DemoIntegrationRow<UserPlatform>[];
	slackUsers: SlackUser[];
	slackChannels: SlackSelectableChannel[];
	slackBotChannels: SlackChannel[];
	slackEmojis: Record<string, string>;
	notionPages: DemoNotionPage[];
	incidents: DemoIncident[];
	analyses: DemoAnalysis[];
	affections: DemoAffection[];
	eventSeq: number;
};

function makeId(prefix: string): string {
	return `${prefix}-${crypto.randomUUID()}`;
}

function makeInitialState(): DemoState {
	const now = new Date();
	const demoUserId = "demo-user";
	const teamWebId = "team-web";
	const teamPlatformId = "team-platform";
	const rotationWebId = "rotation-web";
	const rotationPlatformId = "rotation-platform";
	const rotationFallbackId = "rotation-fallback";
	const serviceWebId = "service-web";
	const serviceApiId = "service-api";
	const serviceJobsId = "service-jobs";
	const statusPageId = "status-page-main";
	const ongoingIncidentId = "incident-demo-ongoing";
	const ongoingIncidentCreatedAt = new Date(now.getTime() - 45 * 60 * 1000);
	const ongoingIncidentAckAt = new Date(now.getTime() - 38 * 60 * 1000);
	const ongoingIncidentMitigatingAt = new Date(now.getTime() - 27 * 60 * 1000);
	const ongoingIncidentUpdateAt = new Date(now.getTime() - 12 * 60 * 1000);

	return {
		version: 1,
		client: {
			id: "demo-client",
			name: "Fire Demo",
			image: null,
			domains: ["firedash.ai"],
			defaultUserRole: "VIEWER",
			autoCreateUsersWithSso: true,
		},
		currentUserId: demoUserId,
		users: [
			{
				id: demoUserId,
				name: "Demo User",
				email: "demo@firedash.ai",
				image: null,
				teams: [{ id: teamWebId, role: "ADMIN" }],
				slackId: "UDEMO001",
				role: "ADMIN",
			},
			{
				id: "user-ana",
				name: "Ana Rivera",
				email: "ana@firedash.ai",
				image: null,
				teams: [{ id: teamWebId, role: "ADMIN" }],
				slackId: "UDEMO002",
				role: "MEMBER",
			},
			{
				id: "user-leo",
				name: "Leo Martin",
				email: "leo@firedash.ai",
				image: null,
				teams: [{ id: teamWebId, role: "ADMIN" }],
				slackId: "UDEMO003",
				role: "MEMBER",
			},
			{
				id: "user-mia",
				name: "Mia Chen",
				email: "mia@firedash.ai",
				image: null,
				teams: [{ id: teamWebId, role: "ADMIN" }],
				slackId: "UDEMO004",
				role: "MEMBER",
			},
			{
				id: "user-noah",
				name: "Noah Patel",
				email: "noah@firedash.ai",
				image: null,
				teams: [{ id: teamPlatformId, role: "ADMIN" }],
				slackId: "UDEMO005",
				role: "MEMBER",
			},
			{
				id: "user-priya",
				name: "Priya Nair",
				email: "priya@firedash.ai",
				image: null,
				teams: [{ id: teamPlatformId, role: "ADMIN" }],
				slackId: "UDEMO006",
				role: "MEMBER",
			},
			{
				id: "user-jules",
				name: "Jules Kim",
				email: "jules@firedash.ai",
				image: null,
				teams: [{ id: teamPlatformId, role: "ADMIN" }],
				slackId: "UDEMO007",
				role: "MEMBER",
			},
			{
				id: "user-emma",
				name: "Emma Brooks",
				email: "emma@firedash.ai",
				image: null,
				teams: [{ id: teamPlatformId, role: "ADMIN" }],
				slackId: "UDEMO008",
				role: "MEMBER",
			},
		],
		teams: [
			{
				id: teamWebId,
				name: "Web Experience",
				imageUrl: "https://images.unsplash.com/photo-1461749280684-dccba630e2f6?auto=format&fit=crop&w=256&q=80",
				createdAt: now,
			},
			{
				id: teamPlatformId,
				name: "Platform Reliability",
				imageUrl: "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=256&q=80",
				createdAt: now,
			},
		],
		services: [
			{
				id: serviceWebId,
				name: "Web",
				description: "Customer-facing web application and checkout experience.",
				prompt: "Frontend incidents: rendering failures, broken flows, auth UI, and checkout UX degradation.",
				imageUrl: null,
				createdAt: now,
				updatedAt: now,
				teamOwnerIds: [teamWebId],
				userOwnerIds: [demoUserId],
				affectsServiceIds: [],
				affectedByServiceIds: [serviceApiId],
			},
			{
				id: serviceApiId,
				name: "API",
				description: "Public and internal API layer used by web and workers.",
				prompt: "API incidents: elevated error rates, latency spikes, auth failures, and endpoint instability.",
				imageUrl: null,
				createdAt: now,
				updatedAt: now,
				teamOwnerIds: [teamPlatformId],
				userOwnerIds: ["user-noah"],
				affectsServiceIds: [serviceWebId, serviceJobsId],
				affectedByServiceIds: [],
			},
			{
				id: serviceJobsId,
				name: "Background Jobs",
				description: "Asynchronous workers for emails, exports, and scheduled processing.",
				prompt: "Worker incidents: queue backlogs, stuck jobs, delayed notifications, and retry storms.",
				imageUrl: null,
				createdAt: now,
				updatedAt: now,
				teamOwnerIds: [teamPlatformId],
				userOwnerIds: ["user-priya"],
				affectsServiceIds: [],
				affectedByServiceIds: [serviceApiId],
			},
		],
		rotations: [
			{
				id: rotationWebId,
				name: "Web On-Call",
				slackChannelId: "CDEMO001",
				shiftStart: now,
				shiftLength: "1 day",
				assigneeIds: [demoUserId, "user-ana", "user-leo", "user-mia"],
				createdAt: now,
				teamId: teamWebId,
			},
			{
				id: rotationPlatformId,
				name: "Platform On-Call",
				slackChannelId: "CDEMO002",
				shiftStart: now,
				shiftLength: "1 day",
				assigneeIds: ["user-noah", "user-priya", "user-jules", "user-emma"],
				createdAt: now,
				teamId: teamPlatformId,
			},
			{
				id: rotationFallbackId,
				name: "Fallback On-Call",
				slackChannelId: "CDEMO003",
				shiftStart: now,
				shiftLength: "1 day",
				assigneeIds: [demoUserId, "user-noah"],
				createdAt: now,
				teamId: null,
			},
		],
		rotationOverrides: [],
		entryPoints: [
			{
				id: "entry-point-web",
				type: "rotation",
				prompt: "Web/UI incidents: broken pages, checkout failures, and customer-facing regressions.",
				rotationId: rotationWebId,
				isFallback: false,
				createdAt: now,
			},
			{
				id: "entry-point-platform",
				type: "rotation",
				prompt: "Platform/API incidents: auth errors, elevated 5xx, latency spikes, and integration failures.",
				rotationId: rotationPlatformId,
				isFallback: false,
				createdAt: now,
			},
			{
				id: "entry-point-fallback",
				type: "rotation",
				prompt: "General incidents when no specific route matches.",
				rotationId: rotationFallbackId,
				isFallback: true,
				createdAt: now,
			},
		],
		statusPages: [
			{
				id: statusPageId,
				name: "FireDash Status",
				slug: "status",
				logoUrl: null,
				faviconUrl: null,
				serviceDisplayMode: "bars_percentage",
				customDomain: null,
				supportUrl: null,
				privacyPolicyUrl: null,
				termsOfServiceUrl: null,
				createdAt: now,
				updatedAt: now,
				services: [
					{ serviceId: serviceWebId, position: 0, description: "Web UI and checkout availability." },
					{ serviceId: serviceApiId, position: 1, description: "API uptime and response performance." },
					{ serviceId: serviceJobsId, position: 2, description: "Background processing health and delays." },
				],
			},
		],
		apiKeys: [],
		workspaceIntegrations: [
			{ platform: "slack", installedAt: now },
			{ platform: "notion", installedAt: now },
		],
		intercomStatusPageId: null,
		userIntegrations: [{ platform: "slack", installedAt: now }],
		slackUsers: [
			{ id: "UDEMO001", name: "Demo User", email: "demo@firedash.ai", avatar: undefined },
			{ id: "UDEMO002", name: "Ana Rivera", email: "ana@firedash.ai", avatar: undefined },
			{ id: "UDEMO003", name: "Leo Martin", email: "leo@firedash.ai", avatar: undefined },
			{ id: "UDEMO004", name: "Mia Chen", email: "mia@firedash.ai", avatar: undefined },
			{ id: "UDEMO005", name: "Noah Patel", email: "noah@firedash.ai", avatar: undefined },
			{ id: "UDEMO006", name: "Priya Nair", email: "priya@firedash.ai", avatar: undefined },
			{ id: "UDEMO007", name: "Jules Kim", email: "jules@firedash.ai", avatar: undefined },
			{ id: "UDEMO008", name: "Emma Brooks", email: "emma@firedash.ai", avatar: undefined },
		],
		slackChannels: [
			{ id: "CDEMO001", name: "web-oncall", isPrivate: false, isMember: true },
			{ id: "CDEMO002", name: "platform-oncall", isPrivate: false, isMember: true },
			{ id: "CDEMO003", name: "incidents-war-room", isPrivate: true, isMember: true },
			{ id: "CDEMO004", name: "api-alerts", isPrivate: false, isMember: true },
		],
		slackBotChannels: [
			{ id: "CDEMO001", name: "web-oncall", isPrivate: false },
			{ id: "CDEMO002", name: "platform-oncall", isPrivate: false },
			{ id: "CDEMO003", name: "incidents-war-room", isPrivate: true },
			{ id: "CDEMO004", name: "api-alerts", isPrivate: false },
		],
		slackEmojis: {
			fire: "\ud83d\udd25",
			rotating_light: "\ud83d\udea8",
			white_check_mark: "\u2705",
		},
		notionPages: [
			{ id: "notion-demo-root", title: "Incident Postmortems", icon: "\ud83d\udcc4" },
			{ id: "notion-demo-eng", title: "Engineering", icon: "\ud83d\udee0\ufe0f" },
		],
		incidents: [
			{
				id: ongoingIncidentId,
				state: {
					id: ongoingIncidentId,
					createdAt: ongoingIncidentCreatedAt,
					status: "mitigating",
					prompt: "Users report intermittent 502 errors during checkout in the web app.",
					severity: "high",
					createdBy: "UDEMO002",
					assignee: { slackId: "UDEMO001" },
					source: "slack",
					title: "Checkout 502 errors on web",
					description: "Checkout requests are intermittently failing with 502 for web users in production.",
					entryPointId: "entry-point-web",
					rotationId: rotationWebId,
					teamId: teamWebId,
				},
				context: {
					channel: "CDEMO001",
					thread: "1700000000.000100",
				},
				events: [
					{
						id: 1,
						event_type: "INCIDENT_CREATED",
						event_data: {
							status: "open",
							severity: "high",
							createdBy: "UDEMO002",
							title: "Checkout 502 errors on web",
							description: "Checkout requests are intermittently failing with 502 for web users in production.",
							prompt: "Users report intermittent 502 errors during checkout in the web app.",
							source: "slack",
							entryPointId: "entry-point-web",
							rotationId: rotationWebId,
							assignee: "UDEMO001",
						},
						created_at: ongoingIncidentCreatedAt.toISOString(),
						adapter: "slack",
					},
					{
						id: 2,
						event_type: "MESSAGE_ADDED",
						event_data: {
							message: "Acknowledged. Investigating API gateway logs and checkout traces now.",
							userId: "UDEMO001",
							messageId: "1700000000.000200",
						},
						created_at: ongoingIncidentAckAt.toISOString(),
						adapter: "slack",
					},
					{
						id: 3,
						event_type: "STATUS_UPDATE",
						event_data: {
							status: "mitigating",
							message: "Mitigating: routing a portion of traffic away from the degraded API shard.",
						},
						created_at: ongoingIncidentMitigatingAt.toISOString(),
						adapter: "dashboard",
					},
					{
						id: 4,
						event_type: "MESSAGE_ADDED",
						event_data: {
							message: "Traffic shift is live. Error rate is dropping but we are monitoring.",
							userId: "UDEMO001",
							messageId: "1700000000.000300",
						},
						created_at: ongoingIncidentUpdateAt.toISOString(),
						adapter: "dashboard",
					},
				],
			},
		],
		analyses: [
			{
				id: ongoingIncidentId,
				clientId: "demo-client",
				title: "Checkout 502 errors on web",
				description: "Checkout requests are intermittently failing with 502 for web users in production.",
				severity: "high",
				assignee: "UDEMO001",
				createdBy: "UDEMO002",
				source: "slack",
				prompt: "Users report intermittent 502 errors during checkout in the web app.",
				createdAt: ongoingIncidentCreatedAt,
				resolvedAt: null,
				events: [
					{
						id: 1,
						event_type: "INCIDENT_CREATED",
						event_data: {
							status: "open",
							severity: "high",
							createdBy: "UDEMO002",
							title: "Checkout 502 errors on web",
							description: "Checkout requests are intermittently failing with 502 for web users in production.",
							prompt: "Users report intermittent 502 errors during checkout in the web app.",
							source: "slack",
							entryPointId: "entry-point-web",
							rotationId: rotationWebId,
							assignee: "UDEMO001",
						},
						created_at: ongoingIncidentCreatedAt.toISOString(),
						adapter: "slack",
					},
					{
						id: 2,
						event_type: "MESSAGE_ADDED",
						event_data: {
							message: "Acknowledged. Investigating API gateway logs and checkout traces now.",
							userId: "UDEMO001",
							messageId: "1700000000.000200",
						},
						created_at: ongoingIncidentAckAt.toISOString(),
						adapter: "slack",
					},
					{
						id: 3,
						event_type: "STATUS_UPDATE",
						event_data: {
							status: "mitigating",
							message: "Mitigating: routing a portion of traffic away from the degraded API shard.",
						},
						created_at: ongoingIncidentMitigatingAt.toISOString(),
						adapter: "dashboard",
					},
					{
						id: 4,
						event_type: "MESSAGE_ADDED",
						event_data: {
							message: "Traffic shift is live. Error rate is dropping but we are monitoring.",
							userId: "UDEMO001",
							messageId: "1700000000.000300",
						},
						created_at: ongoingIncidentUpdateAt.toISOString(),
						adapter: "dashboard",
					},
				],
				timeline: null,
				impact: null,
				rootCause: null,
				actions: [],
				entryPointId: "entry-point-web",
				rotationId: rotationWebId,
				teamId: teamWebId,
				notionPageId: null,
			},
		],
		affections: [],
		eventSeq: 5,
	};
}

async function loadState(): Promise<DemoState> {
	const state = await readKV<DemoState>(STATE_KEY);
	if (state) {
		if (state.intercomStatusPageId === undefined) {
			state.intercomStatusPageId = null;
		}
		if (state.client.defaultUserRole === undefined) {
			state.client.defaultUserRole = "VIEWER";
		}
		if (state.client.autoCreateUsersWithSso === undefined) {
			state.client.autoCreateUsersWithSso = true;
		}
		for (const user of state.users) {
			if (!user.role) {
				user.role = user.id === state.currentUserId ? "ADMIN" : "MEMBER";
			}
			if (!user.teams) {
				user.teams = [];
			}
		}
		return state;
	}
	const initialState = makeInitialState();
	await writeKV(STATE_KEY, initialState);
	return initialState;
}

async function saveState(state: DemoState): Promise<void> {
	await writeKV(STATE_KEY, state);
}

async function withState<T>(fn: (state: DemoState) => T | Promise<T>): Promise<T> {
	const state = await loadState();
	const result = await fn(state);
	await saveState(state);
	return result;
}

function getCurrentUser(state: DemoState): DemoUser {
	const user = state.users.find((candidate) => candidate.id === state.currentUserId);
	if (user) {
		return user;
	}
	const fallback = {
		id: state.currentUserId,
		name: "Demo User",
		email: "demo@firedash.ai",
		image: null,
		teams: [],
		slackId: "UDEMO001",
		role: "ADMIN" as DemoUserRole,
	};
	state.users.push(fallback);
	return fallback;
}

function getUserById(state: DemoState, userId: string): DemoUser | undefined {
	return state.users.find((user) => user.id === userId);
}

function upsertUserFromSlack(state: DemoState, slackUserId: string): DemoUser {
	const slackUser = state.slackUsers.find((user) => user.id === slackUserId);
	if (!slackUser) {
		throw new Error("Slack user not found");
	}

	const existingBySlack = state.users.find((user) => user.slackId === slackUserId);
	if (existingBySlack) {
		return existingBySlack;
	}

	const existingByEmail = state.users.find((user) => user.email === slackUser.email && !!user.email);
	if (existingByEmail) {
		existingByEmail.slackId = slackUserId;
		if (!existingByEmail.image && slackUser.avatar) {
			existingByEmail.image = slackUser.avatar;
		}
		if (!existingByEmail.name) {
			existingByEmail.name = slackUser.name;
		}
		return existingByEmail;
	}

	const created: DemoUser = {
		id: makeId("user"),
		name: slackUser.name,
		email: slackUser.email,
		image: slackUser.avatar ?? null,
		teams: [],
		slackId: slackUser.id,
		role: state.client.defaultUserRole,
	};
	state.users.push(created);
	return created;
}

function sortByCreatedDesc<T extends { createdAt: Date }>(items: T[]): T[] {
	return [...items].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

function normalizeString(value: string | undefined | null): string | null {
	const normalized = value?.trim() ?? "";
	return normalized.length > 0 ? normalized : null;
}

function currentRotationOverride(state: DemoState, rotationId: string, currentTime: Date): DemoRotationOverride | null {
	const candidates = state.rotationOverrides
		.filter((override) => override.rotationId === rotationId && override.startAt < currentTime && override.endAt > currentTime)
		.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
	return candidates[0] ?? null;
}

function getRotationCurrentAssigneeId(state: DemoState, rotation: DemoRotation, currentTime: Date): string | null {
	const override = currentRotationOverride(state, rotation.id, currentTime);
	if (override) {
		return override.assigneeId;
	}
	return rotation.assigneeIds[0] ?? null;
}

function toRotationListItem(state: DemoState, rotation: DemoRotation) {
	const now = new Date();
	const activeOverride = currentRotationOverride(state, rotation.id, now);
	const baseAssignee = rotation.assigneeIds[0] ?? null;
	const currentAssignee = activeOverride?.assigneeId ?? baseAssignee;
	const assignees = rotation.assigneeIds.map((id) => ({
		id,
		isBaseAssignee: baseAssignee === id,
		isOverride: !!activeOverride && activeOverride.assigneeId === id,
	}));
	const isInUse = state.entryPoints.some((entryPoint) => entryPoint.type === "rotation" && entryPoint.rotationId === rotation.id);

	return {
		id: rotation.id,
		name: rotation.name,
		slackChannelId: rotation.slackChannelId,
		shiftStart: rotation.shiftStart,
		shiftLength: rotation.shiftLength,
		assignees,
		createdAt: rotation.createdAt,
		isInUse,
		currentAssignee,
		currentOverrideId: activeOverride?.id ?? null,
		teamId: rotation.teamId,
	};
}

function nextFallbackEntryPoint(state: DemoState): DemoEntryPoint | null {
	return sortByCreatedDesc(state.entryPoints).find((entryPoint) => entryPoint.isFallback) ?? state.entryPoints[0] ?? null;
}

function appendIncidentEvent(state: DemoState, incidentId: string, event: IS_Event, adapter: "slack" | "dashboard" | "fire" = "dashboard"): IncidentEvent {
	const incident = state.incidents.find((item) => item.id === incidentId);
	if (!incident) {
		throw new Error("Incident not found");
	}

	const createdAt = new Date().toISOString();
	const createdEvent = {
		id: state.eventSeq++,
		event_type: event.event_type,
		event_data: event.event_data,
		created_at: createdAt,
		adapter,
	} as IncidentEvent;
	incident.events.push(createdEvent);

	const analysis = state.analyses.find((item) => item.id === incidentId);
	if (analysis) {
		analysis.events.push(createdEvent);
	}

	return createdEvent;
}

function ensureIncidentAnalysis(state: DemoState, incident: DemoIncident): DemoAnalysis {
	const existing = state.analyses.find((analysis) => analysis.id === incident.id);
	if (existing) {
		return existing;
	}

	const analysis: DemoAnalysis = {
		id: incident.id,
		clientId: state.client.id,
		title: incident.state.title,
		description: incident.state.description,
		severity: incident.state.severity,
		assignee: incident.state.assignee.slackId,
		createdBy: incident.state.createdBy,
		source: incident.state.source,
		prompt: incident.state.prompt,
		createdAt: incident.state.createdAt,
		resolvedAt: null,
		events: [...incident.events],
		timeline: null,
		impact: null,
		rootCause: null,
		actions: [],
		entryPointId: incident.state.entryPointId ?? null,
		rotationId: incident.state.rotationId ?? null,
		teamId: incident.state.teamId ?? null,
		notionPageId: null,
	};
	state.analyses.push(analysis);
	return analysis;
}

function getIncidentListItems(state: DemoState): ListIncidentsElement[] {
	return state.incidents
		.filter((incident) => incident.state.status === "open" || incident.state.status === "mitigating")
		.sort((a, b) => b.state.createdAt.getTime() - a.state.createdAt.getTime())
		.map((incident) => ({
			id: incident.state.id,
			status: incident.state.status,
			severity: incident.state.severity,
			createdAt: incident.state.createdAt,
			title: incident.state.title,
			description: incident.state.description,
			assignee: incident.state.assignee,
		}));
}

function computeMetricsFromEvents(events: IncidentEvent[]) {
	if (events.length === 0) {
		return {
			timeToFirstResponse: null,
			timeToAssigneeResponse: null,
			timeToMitigate: null,
			totalDuration: null,
		};
	}

	const ordered = [...events].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
	const startedAt = new Date(ordered[0]!.created_at).getTime();
	let timeToFirstResponse: number | null = null;
	let timeToAssigneeResponse: number | null = null;
	let timeToMitigate: number | null = null;
	let totalDuration: number | null = null;
	const assignees = new Set<string>();

	for (const event of ordered) {
		if (event.event_type === "INCIDENT_CREATED") {
			assignees.add(event.event_data.assignee);
		}
		if (event.event_type === "ASSIGNEE_UPDATE") {
			assignees.add(event.event_data.assignee.slackId);
		}
		if (event.event_type === "MESSAGE_ADDED") {
			if (!event.event_data.userId || event.event_data.userId === "fire") {
				continue;
			}
			const elapsed = new Date(event.created_at).getTime() - startedAt;
			if (timeToFirstResponse === null) {
				timeToFirstResponse = elapsed;
			}
			if (timeToAssigneeResponse === null && assignees.has(event.event_data.userId)) {
				timeToAssigneeResponse = elapsed;
			}
		}
		if (event.event_type === "STATUS_UPDATE") {
			const elapsed = new Date(event.created_at).getTime() - startedAt;
			if (event.event_data.status === "mitigating") {
				timeToMitigate = elapsed;
			}
			if (event.event_data.status === "resolved") {
				totalDuration = elapsed;
			}
		}
	}

	return {
		timeToFirstResponse,
		timeToAssigneeResponse,
		timeToMitigate,
		totalDuration,
	};
}

function getTerminalStatusDetailsFromEvents(events: IncidentEvent[]) {
	for (const event of [...events].reverse()) {
		if (event.event_type !== "STATUS_UPDATE") {
			continue;
		}
		if (event.event_data.status === "declined") {
			const declineReason = event.event_data.message.trim();
			return {
				terminalStatus: "declined" as const,
				declineReason: declineReason.length ? declineReason : null,
			};
		}
		if (event.event_data.status === "resolved") {
			return {
				terminalStatus: "resolved" as const,
				declineReason: null,
			};
		}
	}
	return {
		terminalStatus: "resolved" as const,
		declineReason: null,
	};
}

function ensureUniqueStrings(values: string[]): string[] {
	return Array.from(new Set(values));
}

function toManageableRole(role: DemoUserRole): ManageableUserRole {
	return role === "SUPER_ADMIN" ? "ADMIN" : role;
}

function isRoleEditable(role: DemoUserRole): boolean {
	return role === "VIEWER" || role === "MEMBER";
}

export async function resetDemoState(): Promise<void> {
	await saveState(makeInitialState());
}

export async function getClientDemo() {
	const state = await loadState();
	return {
		name: state.client.name,
		image: state.client.image,
		domains: state.client.domains,
	};
}

export async function updateClientDemo(data: { name?: string; image?: string | null }) {
	return withState(async (state) => {
		if (data.name !== undefined) {
			state.client.name = data.name;
		}
		if (data.image !== undefined) {
			state.client.image = data.image;
		}
		return { name: state.client.name, image: state.client.image };
	});
}

export async function getUsersDemo() {
	const state = await loadState();
	return [...state.users]
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((user) => ({
			id: user.id,
			name: user.name,
			email: user.email,
			image: user.image,
			teams: user.teams,
			slackId: user.slackId,
		}));
}

export async function getCurrentUserDemo() {
	const state = await loadState();
	const user = getCurrentUser(state);
	return {
		id: user.id,
		name: user.name,
		email: user.email,
		image: user.image,
	};
}

export async function updateUserDemo(data: { name?: string; image?: string | null }) {
	return withState(async (state) => {
		const user = getCurrentUser(state);
		if (data.name !== undefined) {
			user.name = data.name;
		}
		if (data.image !== undefined) {
			user.image = data.image;
		}
		return { id: user.id, name: user.name, image: user.image };
	});
}

export async function getWorkspaceUsersForManagementDemo() {
	const state = await loadState();
	return [...state.users]
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((workspaceUser) => ({
			id: workspaceUser.id,
			name: workspaceUser.name,
			email: workspaceUser.email,
			image: workspaceUser.image,
			slackId: workspaceUser.slackId,
			role: toManageableRole(workspaceUser.role),
			isRoleEditable: isRoleEditable(workspaceUser.role),
		}));
}

export async function updateWorkspaceUserRoleDemo(data: { userId: string; role: ManageableUserRole }) {
	return withState(async (state) => {
		const workspaceUser = state.users.find((candidate) => candidate.id === data.userId);
		if (!workspaceUser) {
			throw new Error("User not found");
		}

		if (!isRoleEditable(workspaceUser.role)) {
			throw new Error("You don't have permission to modify this user.");
		}

		workspaceUser.role = data.role;
		return {
			id: workspaceUser.id,
			role: data.role,
			isRoleEditable: isRoleEditable(workspaceUser.role),
		};
	});
}

export async function removeWorkspaceUserDemo(data: { userId: string }) {
	return withState(async (state) => {
		const workspaceUser = state.users.find((candidate) => candidate.id === data.userId);
		if (!workspaceUser) {
			throw new Error("User not found");
		}

		if (!isRoleEditable(workspaceUser.role)) {
			throw new Error("Admin users can't be removed.");
		}

		for (const currentRotation of state.rotations) {
			currentRotation.assigneeIds = currentRotation.assigneeIds.filter((assigneeId) => assigneeId !== data.userId);
		}
		state.rotationOverrides = state.rotationOverrides.filter((currentOverride) => currentOverride.assigneeId !== data.userId);

		const deletedFallback = state.entryPoints.some(
			(currentEntryPoint) => currentEntryPoint.type === "user" && currentEntryPoint.assigneeId === data.userId && currentEntryPoint.isFallback,
		);
		state.entryPoints = state.entryPoints.filter((currentEntryPoint) => !(currentEntryPoint.type === "user" && currentEntryPoint.assigneeId === data.userId));
		if (deletedFallback && state.entryPoints.length > 0 && !state.entryPoints.some((currentEntryPoint) => currentEntryPoint.isFallback)) {
			state.entryPoints[0]!.isFallback = true;
		}

		for (const service of state.services) {
			service.userOwnerIds = service.userOwnerIds.filter((ownerId) => ownerId !== data.userId);
		}

		state.users = state.users.filter((candidate) => candidate.id !== data.userId);
		return { success: true };
	});
}

export async function getWorkspaceUserProvisioningSettingsDemo() {
	const state = await loadState();
	return {
		defaultUserRole: state.client.defaultUserRole,
		autoCreateUsersWithSso: state.client.autoCreateUsersWithSso,
	};
}

export async function updateWorkspaceUserProvisioningSettingsDemo(data: { defaultUserRole?: ManageableUserRole; autoCreateUsersWithSso?: boolean }) {
	return withState(async (state) => {
		if (data.defaultUserRole !== undefined) {
			state.client.defaultUserRole = data.defaultUserRole;
		}
		if (data.autoCreateUsersWithSso !== undefined) {
			state.client.autoCreateUsersWithSso = data.autoCreateUsersWithSso;
		}
		return {
			defaultUserRole: state.client.defaultUserRole,
			autoCreateUsersWithSso: state.client.autoCreateUsersWithSso,
		};
	});
}

export async function addWorkspaceUserFromSlackDemo(data: { slackUserId: string }) {
	return withState(async (state) => {
		const slackConnected = state.workspaceIntegrations.some((workspaceIntegration) => workspaceIntegration.platform === "slack");
		if (!slackConnected) {
			throw new Error("Slack isn't connected to this workspace.");
		}

		const slackUser = state.slackUsers.find((candidate) => candidate.id === data.slackUserId);
		if (!slackUser) {
			throw new Error("Slack user not found.");
		}

		if (!slackUser.email) {
			throw new Error("Slack user has no email.");
		}

		const domain = slackUser.email.toLowerCase().split("@")[1];
		if (!domain || !state.client.domains.map((item) => item.toLowerCase()).includes(domain)) {
			throw new Error("Email domain not allowed for this workspace.");
		}

		const existingByEmail = state.users.find((workspaceUser) => workspaceUser.email.toLowerCase() === slackUser.email.toLowerCase());
		if (existingByEmail) {
			if (existingByEmail.slackId && existingByEmail.slackId !== data.slackUserId) {
				throw new Error("User linked to a different Slack user.");
			}
			if (!existingByEmail.slackId) {
				existingByEmail.slackId = data.slackUserId;
			}
			if (!existingByEmail.image && slackUser.avatar) {
				existingByEmail.image = slackUser.avatar;
			}
			if (!existingByEmail.name && slackUser.name) {
				existingByEmail.name = slackUser.name;
			}
			return {
				id: existingByEmail.id,
				name: existingByEmail.name,
				email: existingByEmail.email,
				image: existingByEmail.image,
				slackId: existingByEmail.slackId,
				role: toManageableRole(existingByEmail.role),
				isRoleEditable: isRoleEditable(existingByEmail.role),
			};
		}

		const created = upsertUserFromSlack(state, data.slackUserId);
		return {
			id: created.id,
			name: created.name,
			email: created.email,
			image: created.image,
			slackId: created.slackId,
			role: toManageableRole(created.role),
			isRoleEditable: isRoleEditable(created.role),
		};
	});
}

export async function getTeamsDemo() {
	const state = await loadState();
	return sortByCreatedDesc(state.teams).map((team) => ({
		id: team.id,
		name: team.name,
		imageUrl: team.imageUrl,
		createdAt: team.createdAt,
		memberCount: state.users.filter((user) => user.teams.some((membership) => membership.id === team.id)).length,
	}));
}

export async function createTeamDemo(data: { name: string }) {
	return withState(async (state) => {
		const created: DemoTeam = {
			id: makeId("team"),
			name: data.name,
			imageUrl: null,
			createdAt: new Date(),
		};
		state.teams.unshift(created);
		return {
			id: created.id,
			name: created.name,
			imageUrl: created.imageUrl,
			createdAt: created.createdAt,
			memberCount: 0,
		};
	});
}

export async function deleteTeamDemo(data: { id: string }) {
	return withState(async (state) => {
		state.teams = state.teams.filter((team) => team.id !== data.id);
		for (const user of state.users) {
			user.teams = user.teams.filter((membership) => membership.id !== data.id);
		}
		for (const rotation of state.rotations) {
			if (rotation.teamId === data.id) {
				rotation.teamId = null;
			}
		}
		for (const service of state.services) {
			service.teamOwnerIds = service.teamOwnerIds.filter((teamId) => teamId !== data.id);
		}
		return { success: true };
	});
}

export async function addTeamMemberDemo(data: { teamId: string; userId: string }) {
	return withState(async (state) => {
		const team = state.teams.find((candidate) => candidate.id === data.teamId);
		if (!team) {
			throw new Error("Team not found");
		}
		const user = getUserById(state, data.userId);
		if (!user) {
			throw new Error("User not found");
		}
		if (!user.teams.some((membership) => membership.id === data.teamId)) {
			user.teams.push({ id: data.teamId, role: "ADMIN" });
		}
		return { success: true };
	});
}

export async function removeTeamMemberDemo(data: { teamId: string; userId: string }) {
	return withState(async (state) => {
		const user = getUserById(state, data.userId);
		if (!user) {
			throw new Error("User not found");
		}
		user.teams = user.teams.filter((membership) => membership.id !== data.teamId);
		return { success: true };
	});
}

export async function updateTeamMemberRoleDemo(data: { teamId: string; userId: string; role: DemoTeamMembershipRole }) {
	return withState(async (state) => {
		const user = getUserById(state, data.userId);
		if (!user) {
			throw new Error("User not found");
		}

		const membership = user.teams.find((candidate) => candidate.id === data.teamId);
		if (!membership) {
			throw new Error("Team member not found.");
		}

		membership.role = data.role;
		return { teamId: data.teamId, userId: data.userId, role: data.role };
	});
}

export async function updateTeamDemo(data: { id: string; name?: string; imageUrl?: string | null }) {
	return withState(async (state) => {
		const team = state.teams.find((candidate) => candidate.id === data.id);
		if (!team) {
			throw new Error("Team not found");
		}
		if (data.name !== undefined) {
			team.name = data.name;
		}
		if (data.imageUrl !== undefined) {
			team.imageUrl = data.imageUrl;
		}
		return { id: team.id, name: team.name, imageUrl: team.imageUrl };
	});
}

export async function addSlackUserAsTeamMemberDemo(data: { teamId: string; slackUserId: string }) {
	return withState(async (state) => {
		const user = upsertUserFromSlack(state, data.slackUserId);
		if (!user.teams.some((membership) => membership.id === data.teamId)) {
			user.teams.push({ id: data.teamId, role: "ADMIN" });
		}
		return { success: true, userId: user.id };
	});
}

export async function getServicesDemo() {
	const state = await loadState();
	return sortByCreatedDesc(state.services).map((service) => ({
		id: service.id,
		name: service.name,
		description: service.description,
		prompt: service.prompt,
		imageUrl: service.imageUrl,
		createdAt: service.createdAt,
		updatedAt: service.updatedAt,
		teamOwnerIds: service.teamOwnerIds,
		userOwnerIds: service.userOwnerIds,
		affectsServiceIds: service.affectsServiceIds,
		affectedByServiceIds: service.affectedByServiceIds,
	}));
}

export async function createServiceDemo(data: { name?: string; description?: string | null; prompt?: string | null; teamOwnerIds?: string[] }) {
	return withState(async (state) => {
		const now = new Date();
		const created: DemoService = {
			id: makeId("service"),
			name: data.name?.trim() ?? "",
			description: normalizeString(data.description),
			prompt: normalizeString(data.prompt),
			imageUrl: null,
			createdAt: now,
			updatedAt: now,
			teamOwnerIds: ensureUniqueStrings(data.teamOwnerIds ?? []),
			userOwnerIds: [],
			affectsServiceIds: [],
			affectedByServiceIds: [],
		};
		state.services.unshift(created);
		return {
			id: created.id,
			name: created.name,
			description: created.description,
			prompt: created.prompt,
			imageUrl: created.imageUrl,
			createdAt: created.createdAt,
			updatedAt: created.updatedAt,
			teamOwnerIds: created.teamOwnerIds,
			userOwnerIds: created.userOwnerIds,
			affectsServiceIds: created.affectsServiceIds,
			affectedByServiceIds: created.affectedByServiceIds,
		};
	});
}

export async function updateServiceDemo(data: { id: string; name?: string; description?: string | null; prompt?: string | null; imageUrl?: string | null }) {
	return withState(async (state) => {
		const service = state.services.find((candidate) => candidate.id === data.id);
		if (!service) {
			throw new Error("Service not found");
		}
		if (data.name !== undefined) {
			service.name = data.name.trim();
		}
		if (data.description !== undefined) {
			service.description = normalizeString(data.description);
		}
		if (data.prompt !== undefined) {
			service.prompt = normalizeString(data.prompt);
		}
		if (data.imageUrl !== undefined) {
			service.imageUrl = data.imageUrl;
		}
		service.updatedAt = new Date();
		return {
			id: service.id,
			name: service.name,
			description: service.description,
			prompt: service.prompt,
			imageUrl: service.imageUrl,
			updatedAt: service.updatedAt,
		};
	});
}

export async function deleteServiceDemo(data: { id: string }) {
	return withState(async (state) => {
		state.services = state.services.filter((service) => service.id !== data.id);
		for (const service of state.services) {
			service.affectsServiceIds = service.affectsServiceIds.filter((id) => id !== data.id);
			service.affectedByServiceIds = service.affectedByServiceIds.filter((id) => id !== data.id);
		}
		for (const page of state.statusPages) {
			page.services = page.services.filter((link) => link.serviceId !== data.id);
		}
		return { success: true };
	});
}

export async function addServiceTeamOwnerDemo(data: { serviceId: string; teamId: string }) {
	return withState(async (state) => {
		const service = state.services.find((candidate) => candidate.id === data.serviceId);
		if (!service) {
			throw new Error("Service not found");
		}
		service.teamOwnerIds = ensureUniqueStrings([...service.teamOwnerIds, data.teamId]);
		return { success: true };
	});
}

export async function removeServiceTeamOwnerDemo(data: { serviceId: string; teamId: string }) {
	return withState(async (state) => {
		const service = state.services.find((candidate) => candidate.id === data.serviceId);
		if (!service) {
			throw new Error("Service not found");
		}
		service.teamOwnerIds = service.teamOwnerIds.filter((id) => id !== data.teamId);
		return { success: true };
	});
}

export async function addServiceUserOwnerDemo(data: { serviceId: string; userId: string }) {
	return withState(async (state) => {
		const service = state.services.find((candidate) => candidate.id === data.serviceId);
		if (!service) {
			throw new Error("Service not found");
		}
		service.userOwnerIds = ensureUniqueStrings([...service.userOwnerIds, data.userId]);
		return { success: true };
	});
}

export async function removeServiceUserOwnerDemo(data: { serviceId: string; userId: string }) {
	return withState(async (state) => {
		const service = state.services.find((candidate) => candidate.id === data.serviceId);
		if (!service) {
			throw new Error("Service not found");
		}
		service.userOwnerIds = service.userOwnerIds.filter((id) => id !== data.userId);
		return { success: true };
	});
}

export async function addServiceDependencyDemo(data: { baseServiceId: string; affectedServiceId: string }) {
	return withState(async (state) => {
		if (data.baseServiceId === data.affectedServiceId) {
			throw new Error("Service cannot depend on itself");
		}
		const base = state.services.find((candidate) => candidate.id === data.baseServiceId);
		const affected = state.services.find((candidate) => candidate.id === data.affectedServiceId);
		if (!base || !affected) {
			throw new Error("Service not found");
		}
		base.affectsServiceIds = ensureUniqueStrings([...base.affectsServiceIds, affected.id]);
		affected.affectedByServiceIds = ensureUniqueStrings([...affected.affectedByServiceIds, base.id]);
		return { success: true };
	});
}

export async function removeServiceDependencyDemo(data: { baseServiceId: string; affectedServiceId: string }) {
	return withState(async (state) => {
		const base = state.services.find((candidate) => candidate.id === data.baseServiceId);
		const affected = state.services.find((candidate) => candidate.id === data.affectedServiceId);
		if (!base || !affected) {
			throw new Error("Service not found");
		}
		base.affectsServiceIds = base.affectsServiceIds.filter((id) => id !== affected.id);
		affected.affectedByServiceIds = affected.affectedByServiceIds.filter((id) => id !== base.id);
		return { success: true };
	});
}

export async function getWorkspaceIntegrationsDemo() {
	const state = await loadState();
	return state.workspaceIntegrations.map((integration) => ({ ...integration }));
}

export async function getIntercomWorkspaceConfigDemo() {
	const state = await loadState();
	const connected = state.workspaceIntegrations.some((integration) => integration.platform === "intercom");
	return {
		connected,
		workspaceId: connected ? "demo-intercom-workspace" : null,
		workspaceName: connected ? "Demo Intercom Workspace" : null,
		statusPageId: state.intercomStatusPageId,
	};
}

export async function getUserIntegrationsDemo() {
	const state = await loadState();
	return state.userIntegrations.map((integration) => ({ ...integration }));
}

export async function connectWorkspaceIntegrationDemo(platform: WorkspacePlatform) {
	return withState(async (state) => {
		const existing = state.workspaceIntegrations.find((integration) => integration.platform === platform);
		if (existing) {
			existing.installedAt = new Date();
		} else {
			state.workspaceIntegrations.push({ platform, installedAt: new Date() });
		}
		return { success: true };
	});
}

export async function connectUserIntegrationDemo(platform: UserPlatform) {
	return withState(async (state) => {
		const existing = state.userIntegrations.find((integration) => integration.platform === platform);
		if (existing) {
			existing.installedAt = new Date();
		} else {
			state.userIntegrations.push({ platform, installedAt: new Date() });
		}
		return { success: true };
	});
}

export async function disconnectWorkspaceIntegrationDemo(platform: WorkspacePlatform) {
	return withState(async (state) => {
		state.workspaceIntegrations = state.workspaceIntegrations.filter((integration) => integration.platform !== platform);
		if (platform === "intercom") {
			state.intercomStatusPageId = null;
		}
		return { success: true };
	});
}

export async function setIntercomStatusPageDemo(data: { statusPageId: string }) {
	return withState(async (state) => {
		const connected = state.workspaceIntegrations.some((integration) => integration.platform === "intercom");
		if (!connected) {
			throw new Error("Connect Intercom before selecting a status page");
		}

		const statusPageId = data.statusPageId.trim();
		if (!statusPageId) {
			throw new Error("Status page is required");
		}

		const exists = state.statusPages.some((page) => page.id === statusPageId);
		if (!exists) {
			throw new Error("Status page not found");
		}

		state.intercomStatusPageId = statusPageId;
		return { success: true };
	});
}

export async function disconnectUserIntegrationDemo(platform: UserPlatform) {
	return withState(async (state) => {
		state.userIntegrations = state.userIntegrations.filter((integration) => integration.platform !== platform);
		return { success: true };
	});
}

export async function getSlackUsersDemo() {
	const state = await loadState();
	return [...state.slackUsers];
}

export async function getSlackSelectableChannelsDemo() {
	const state = await loadState();
	return [...state.slackChannels];
}

export async function getSlackBotChannelsDemo() {
	const state = await loadState();
	return [...state.slackBotChannels];
}

export async function getSlackEmojisDemo() {
	const state = await loadState();
	return { ...state.slackEmojis };
}

export async function getEntryPointsDemo(): Promise<GetEntryPointsResponse> {
	const state = await loadState();
	return sortByCreatedDesc(state.entryPoints).map((entryPoint): GetEntryPointsResponse[number] => {
		if (entryPoint.type === "rotation") {
			const rotation = state.rotations.find((candidate) => candidate.id === entryPoint.rotationId);
			return {
				id: entryPoint.id,
				type: "rotation" as const,
				prompt: entryPoint.prompt,
				rotationId: entryPoint.rotationId ?? null,
				isFallback: entryPoint.isFallback,
				teamId: rotation?.teamId ?? null,
			};
		}
		return {
			id: entryPoint.id,
			type: "user" as const,
			prompt: entryPoint.prompt,
			assigneeId: entryPoint.assigneeId!,
			isFallback: entryPoint.isFallback,
			teamId: undefined,
		};
	});
}

export async function createEntryPointDemo(
	data: { type: "user"; userId: string; prompt?: string } | { type: "rotation"; rotationId: string; prompt?: string; teamId?: string },
): Promise<CreateEntryPointResponse> {
	return withState(async (state) => {
		const isFirst = state.entryPoints.length === 0;
		const created: DemoEntryPoint = {
			id: makeId("entry-point"),
			type: data.type,
			prompt: data.prompt ?? "",
			isFallback: isFirst,
			createdAt: new Date(),
			...(data.type === "user" ? { assigneeId: data.userId } : { rotationId: data.rotationId }),
		};
		state.entryPoints.unshift(created);
		if (created.type === "user") {
			return {
				id: created.id,
				type: created.type,
				prompt: created.prompt,
				assigneeId: created.assigneeId,
				rotationId: undefined,
				isFallback: created.isFallback,
			};
		}
		return {
			id: created.id,
			type: created.type,
			prompt: created.prompt,
			assigneeId: undefined,
			rotationId: created.rotationId,
			isFallback: created.isFallback,
		};
	});
}

export async function createEntryPointFromSlackUserDemo(data: { slackUserId: string; prompt?: string }): Promise<CreateEntryPointFromSlackUserResponse> {
	return withState(async (state) => {
		const user = upsertUserFromSlack(state, data.slackUserId);
		const isFirst = state.entryPoints.length === 0;
		const created: DemoEntryPoint = {
			id: makeId("entry-point"),
			type: "user",
			prompt: data.prompt ?? "",
			assigneeId: user.id,
			isFallback: isFirst,
			createdAt: new Date(),
		};
		state.entryPoints.unshift(created);
		return {
			id: created.id,
			type: "user" as const,
			prompt: created.prompt,
			assigneeId: created.assigneeId ?? null,
			rotationId: undefined,
			isFallback: created.isFallback,
		};
	});
}

export async function deleteEntryPointDemo(data: { id: string }) {
	return withState(async (state) => {
		const deleted = state.entryPoints.find((entryPoint) => entryPoint.id === data.id);
		state.entryPoints = state.entryPoints.filter((entryPoint) => entryPoint.id !== data.id);
		if (deleted?.isFallback && state.entryPoints.length > 0) {
			for (const entryPoint of state.entryPoints) {
				entryPoint.isFallback = false;
			}
			state.entryPoints[0]!.isFallback = true;
		}
		return { success: true };
	});
}

export async function updateEntryPointPromptDemo(data: { id: string; prompt: string }): Promise<UpdateEntryPointPromptResponse> {
	return withState(async (state) => {
		const entryPoint = state.entryPoints.find((candidate) => candidate.id === data.id);
		if (!entryPoint) {
			throw new Error("Entry point not found");
		}
		entryPoint.prompt = data.prompt;
		return {
			id: entryPoint.id,
			type: entryPoint.type,
			prompt: entryPoint.prompt,
			assigneeId: entryPoint.assigneeId ?? null,
			rotationId: entryPoint.rotationId ?? null,
			isFallback: entryPoint.isFallback,
		};
	});
}

export async function setFallbackEntryPointDemo(data: { id: string }) {
	return withState(async (state) => {
		for (const entryPoint of state.entryPoints) {
			entryPoint.isFallback = entryPoint.id === data.id;
		}
		return { success: true };
	});
}

export async function getRotationsDemo() {
	const state = await loadState();
	return sortByCreatedDesc(state.rotations).map((rotation) => toRotationListItem(state, rotation));
}

export async function createRotationDemo(data: { name: string; shiftLength: string; anchorAt?: Date; teamId?: string }) {
	return withState(async (state) => {
		const created: DemoRotation = {
			id: makeId("rotation"),
			name: data.name,
			slackChannelId: null,
			shiftStart: data.anchorAt ?? null,
			shiftLength: data.shiftLength,
			assigneeIds: [],
			createdAt: new Date(),
			teamId: data.teamId ?? null,
		};
		state.rotations.unshift(created);
		return {
			id: created.id,
			name: created.name,
			anchorAt: created.shiftStart,
			shiftLength: created.shiftLength,
		};
	});
}

export async function deleteRotationDemo(data: { id: string }) {
	return withState(async (state) => {
		if (state.entryPoints.some((entryPoint) => entryPoint.type === "rotation" && entryPoint.rotationId === data.id)) {
			throw new Error("Cannot delete rotation: it is used in an entry point");
		}
		state.rotations = state.rotations.filter((rotation) => rotation.id !== data.id);
		state.rotationOverrides = state.rotationOverrides.filter((override) => override.rotationId !== data.id);
		return { success: true };
	});
}

export async function updateRotationNameDemo(data: { id: string; name: string }) {
	return withState(async (state) => {
		const rotation = state.rotations.find((candidate) => candidate.id === data.id);
		if (!rotation) {
			throw new Error("Rotation not found");
		}
		rotation.name = data.name;
		return { id: rotation.id, name: rotation.name };
	});
}

export async function updateRotationTeamDemo(data: { id: string; teamId: string | null }) {
	return withState(async (state) => {
		const rotation = state.rotations.find((candidate) => candidate.id === data.id);
		if (!rotation) {
			throw new Error("Rotation not found");
		}
		rotation.teamId = data.teamId;
		return { id: rotation.id, teamId: rotation.teamId };
	});
}

export async function updateRotationSlackChannelDemo(data: { id: string; slackChannelId: string | null }) {
	return withState(async (state) => {
		const rotation = state.rotations.find((candidate) => candidate.id === data.id);
		if (!rotation) {
			throw new Error("Rotation not found");
		}
		rotation.slackChannelId = data.slackChannelId;
		return { id: rotation.id, slackChannelId: rotation.slackChannelId };
	});
}

export async function updateRotationShiftLengthDemo(data: { id: string; shiftLength: string }) {
	return withState(async (state) => {
		const rotation = state.rotations.find((candidate) => candidate.id === data.id);
		if (!rotation) {
			throw new Error("Rotation not found");
		}
		rotation.shiftLength = data.shiftLength;
		return { id: rotation.id, shiftLength: rotation.shiftLength };
	});
}

export async function addRotationAssigneeDemo(data: { rotationId: string; assigneeId: string }) {
	return withState(async (state) => {
		const rotation = state.rotations.find((candidate) => candidate.id === data.rotationId);
		if (!rotation) {
			throw new Error("Rotation not found");
		}
		rotation.assigneeIds = ensureUniqueStrings([...rotation.assigneeIds, data.assigneeId]);
		return { success: true };
	});
}

export async function addSlackUserAsRotationAssigneeDemo(data: { rotationId: string; slackUserId: string }) {
	return withState(async (state) => {
		const user = upsertUserFromSlack(state, data.slackUserId);
		const rotation = state.rotations.find((candidate) => candidate.id === data.rotationId);
		if (!rotation) {
			throw new Error("Rotation not found");
		}
		rotation.assigneeIds = ensureUniqueStrings([...rotation.assigneeIds, user.id]);
		return { success: true, userId: user.id };
	});
}

export async function reorderRotationAssigneeDemo(data: { rotationId: string; assigneeId: string; newPosition: number }) {
	return withState(async (state) => {
		const rotation = state.rotations.find((candidate) => candidate.id === data.rotationId);
		if (!rotation) {
			throw new Error("Rotation not found");
		}
		const currentIndex = rotation.assigneeIds.indexOf(data.assigneeId);
		if (currentIndex === -1) {
			return { success: true };
		}
		const [assigneeId] = rotation.assigneeIds.splice(currentIndex, 1);
		rotation.assigneeIds.splice(Math.max(0, Math.min(rotation.assigneeIds.length, data.newPosition)), 0, assigneeId!);
		return { success: true };
	});
}

export async function removeRotationAssigneeDemo(data: { rotationId: string; assigneeId: string }) {
	return withState(async (state) => {
		const rotation = state.rotations.find((candidate) => candidate.id === data.rotationId);
		if (!rotation) {
			throw new Error("Rotation not found");
		}
		rotation.assigneeIds = rotation.assigneeIds.filter((id) => id !== data.assigneeId);
		return { success: true };
	});
}

export async function getRotationOverridesDemo(data: { rotationId: string; startAt: Date; endAt: Date }) {
	const state = await loadState();
	return state.rotationOverrides
		.filter((override) => override.rotationId === data.rotationId && override.startAt < data.endAt && override.endAt > data.startAt)
		.sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
		.map((override) => ({
			id: override.id,
			assigneeId: override.assigneeId,
			startAt: override.startAt,
			endAt: override.endAt,
			createdAt: override.createdAt,
		}));
}

export async function createRotationOverrideDemo(data: { rotationId: string; assigneeId: string; startAt: Date; endAt: Date }) {
	return withState(async (state) => {
		const override: DemoRotationOverride = {
			id: makeId("rotation-override"),
			rotationId: data.rotationId,
			assigneeId: data.assigneeId,
			startAt: data.startAt,
			endAt: data.endAt,
			createdAt: new Date(),
		};
		state.rotationOverrides.push(override);
		return { id: override.id };
	});
}

export async function setRotationOverrideDemo(data: { rotationId: string; assigneeId: string }) {
	return withState(async (state) => {
		const now = new Date();
		const override: DemoRotationOverride = {
			id: makeId("rotation-override"),
			rotationId: data.rotationId,
			assigneeId: data.assigneeId,
			startAt: now,
			endAt: new Date(now.getTime() + 8 * 60 * 60 * 1000),
			createdAt: now,
		};
		state.rotationOverrides.push(override);
		return { success: true };
	});
}

export async function clearRotationOverrideDemo(data: { rotationId: string; overrideId: string }) {
	return withState(async (state) => {
		state.rotationOverrides = state.rotationOverrides.filter((override) => !(override.rotationId === data.rotationId && override.id === data.overrideId));
		return { success: true };
	});
}

export async function updateRotationOverrideDemo(data: { rotationId: string; overrideId: string; assigneeId: string; startAt: Date; endAt: Date }) {
	return withState(async (state) => {
		const override = state.rotationOverrides.find((candidate) => candidate.rotationId === data.rotationId && candidate.id === data.overrideId);
		if (!override) {
			throw new Error("Override not found");
		}
		override.assigneeId = data.assigneeId;
		override.startAt = data.startAt;
		override.endAt = data.endAt;
		return { id: override.id };
	});
}

export async function updateRotationAnchorDemo(data: { id: string; anchorAt: Date }) {
	return withState(async (state) => {
		const rotation = state.rotations.find((candidate) => candidate.id === data.id);
		if (!rotation) {
			throw new Error("Rotation not found");
		}
		rotation.shiftStart = data.anchorAt;
		return { id: rotation.id, anchorAt: rotation.shiftStart };
	});
}

function toStatusPageServiceItem(state: DemoState, link: DemoStatusPageLink) {
	const service = state.services.find((candidate) => candidate.id === link.serviceId);
	if (!service) {
		return null;
	}
	return {
		id: service.id,
		name: service.name,
		description: link.description,
		imageUrl: service.imageUrl,
		position: link.position,
		createdAt: service.createdAt,
	};
}

function toStatusPageItem(state: DemoState, page: DemoStatusPage) {
	const services = page.services
		.map((link) => toStatusPageServiceItem(state, link))
		.filter((service): service is NonNullable<typeof service> => !!service)
		.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));

	return {
		id: page.id,
		name: page.name,
		slug: page.slug,
		logoUrl: page.logoUrl,
		faviconUrl: page.faviconUrl,
		serviceDisplayMode: page.serviceDisplayMode,
		customDomain: page.customDomain,
		supportUrl: page.supportUrl,
		privacyPolicyUrl: page.privacyPolicyUrl,
		termsOfServiceUrl: page.termsOfServiceUrl,
		createdAt: page.createdAt,
		updatedAt: page.updatedAt,
		services,
		serviceCount: services.length,
	};
}

export async function getStatusPagesDemo() {
	const state = await loadState();
	return sortByCreatedDesc(state.statusPages).map((page) => toStatusPageItem(state, page));
}

function toSlug(value: string): string {
	return value
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9-]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

export async function createStatusPageDemo(data: { name: string; slug: string }) {
	return withState(async (state) => {
		const created: DemoStatusPage = {
			id: makeId("status-page"),
			name: data.name.trim(),
			slug: toSlug(data.slug),
			logoUrl: null,
			faviconUrl: null,
			serviceDisplayMode: "bars_percentage",
			customDomain: null,
			supportUrl: null,
			privacyPolicyUrl: null,
			termsOfServiceUrl: null,
			createdAt: new Date(),
			updatedAt: new Date(),
			services: [],
		};
		state.statusPages.unshift(created);
		return toStatusPageItem(state, created);
	});
}

export async function updateStatusPageDemo(data: {
	id: string;
	name?: string;
	slug?: string;
	logoUrl?: string | null;
	faviconUrl?: string | null;
	serviceDisplayMode?: string | null;
	customDomain?: string | null;
	supportUrl?: string | null;
	privacyPolicyUrl?: string | null;
	termsOfServiceUrl?: string | null;
}) {
	return withState(async (state) => {
		const page = state.statusPages.find((candidate) => candidate.id === data.id);
		if (!page) {
			throw new Error("Status page not found");
		}
		if (data.name !== undefined) page.name = data.name.trim();
		if (data.slug !== undefined) page.slug = toSlug(data.slug);
		if (data.logoUrl !== undefined) page.logoUrl = data.logoUrl;
		if (data.faviconUrl !== undefined) page.faviconUrl = data.faviconUrl;
		if (data.serviceDisplayMode !== undefined) page.serviceDisplayMode = data.serviceDisplayMode;
		if (data.customDomain !== undefined) page.customDomain = normalizeString(data.customDomain);
		if (data.supportUrl !== undefined) page.supportUrl = normalizeString(data.supportUrl);
		if (data.privacyPolicyUrl !== undefined) page.privacyPolicyUrl = normalizeString(data.privacyPolicyUrl);
		if (data.termsOfServiceUrl !== undefined) page.termsOfServiceUrl = normalizeString(data.termsOfServiceUrl);
		page.updatedAt = new Date();
		return {
			id: page.id,
			name: page.name,
			slug: page.slug,
			logoUrl: page.logoUrl,
			faviconUrl: page.faviconUrl,
			serviceDisplayMode: page.serviceDisplayMode,
			customDomain: page.customDomain,
			supportUrl: page.supportUrl,
			privacyPolicyUrl: page.privacyPolicyUrl,
			termsOfServiceUrl: page.termsOfServiceUrl,
			updatedAt: page.updatedAt,
		};
	});
}

export async function deleteStatusPageDemo(data: { id: string }) {
	return withState(async (state) => {
		state.statusPages = state.statusPages.filter((page) => page.id !== data.id);
		return { success: true };
	});
}

export async function updateStatusPageServicesDemo(data: { id: string; serviceIds: string[] }) {
	return withState(async (state) => {
		const page = state.statusPages.find((candidate) => candidate.id === data.id);
		if (!page) {
			throw new Error("Status page not found");
		}
		page.services = ensureUniqueStrings(data.serviceIds).map((serviceId, index) => ({
			serviceId,
			position: index,
			description: page.services.find((current) => current.serviceId === serviceId)?.description ?? null,
		}));
		page.updatedAt = new Date();
		return { success: true };
	});
}

export async function updateStatusPageServiceDescriptionDemo(data: { statusPageId: string; serviceId: string; description: string | null }) {
	return withState(async (state) => {
		const page = state.statusPages.find((candidate) => candidate.id === data.statusPageId);
		if (!page) {
			throw new Error("Status page not found");
		}
		const link = page.services.find((current) => current.serviceId === data.serviceId);
		if (!link) {
			throw new Error("Service not found on status page");
		}
		link.description = normalizeString(data.description);
		page.updatedAt = new Date();
		return { success: true };
	});
}

export async function verifyCustomDomainDemo(_data: { id: string }): Promise<VerifyCustomDomainResponse> {
	throw new Error("Custom domain verification is not supported in demo mode.");
}

export async function getApiKeysDemo() {
	const state = await loadState();
	return sortByCreatedDesc(state.apiKeys).map((key) => ({
		id: key.id,
		name: key.name,
		keyPrefix: key.keyPrefix,
		createdAt: key.createdAt,
		lastUsedAt: key.lastUsedAt,
	}));
}

function makeApiKeyString(): string {
	const random = crypto.randomUUID().replace(/-/g, "");
	return `fire_${random}`;
}

export async function createApiKeyDemo(data: { name: string }) {
	return withState(async (state) => {
		const key = makeApiKeyString();
		const row: DemoApiKey = {
			id: makeId("api-key"),
			name: data.name,
			keyPrefix: key.slice(0, 12),
			createdAt: new Date(),
			lastUsedAt: null,
		};
		state.apiKeys.unshift(row);
		return {
			id: row.id,
			name: row.name,
			key,
			keyPrefix: row.keyPrefix,
		};
	});
}

export async function revokeApiKeyDemo(data: { id: string }) {
	return withState(async (state) => {
		state.apiKeys = state.apiKeys.filter((key) => key.id !== data.id);
		return { success: true };
	});
}

function selectEntryPointForIncident(state: DemoState): { entryPoint: DemoEntryPoint | null; assigneeSlackId: string; rotationId: string | undefined; teamId: string | undefined } {
	const fallback = nextFallbackEntryPoint(state);
	if (!fallback) {
		const user = getCurrentUser(state);
		return {
			entryPoint: null,
			assigneeSlackId: user.slackId ?? "UDEMO001",
			rotationId: undefined,
			teamId: undefined,
		};
	}

	if (fallback.type === "user") {
		const assignee = fallback.assigneeId ? state.users.find((user) => user.id === fallback.assigneeId) : undefined;
		const slackId = assignee?.slackId ?? getCurrentUser(state).slackId ?? "UDEMO001";
		return {
			entryPoint: fallback,
			assigneeSlackId: slackId,
			rotationId: undefined,
			teamId: undefined,
		};
	}

	const rotation = fallback.rotationId ? state.rotations.find((candidate) => candidate.id === fallback.rotationId) : undefined;
	const assigneeId = rotation ? getRotationCurrentAssigneeId(state, rotation, new Date()) : null;
	const assignee = assigneeId ? state.users.find((user) => user.id === assigneeId) : undefined;
	const slackId = assignee?.slackId ?? getCurrentUser(state).slackId ?? "UDEMO001";
	return {
		entryPoint: fallback,
		assigneeSlackId: slackId,
		rotationId: rotation?.id,
		teamId: rotation?.teamId ?? undefined,
	};
}

export async function startIncidentDemo(data: { prompt: string; channel?: string }) {
	return withState(async (state) => {
		const incidentId = makeId("incident");
		const createdAt = new Date();
		const title = data.prompt.trim().slice(0, 120) || "Untitled incident";
		const entrySelection = selectEntryPointForIncident(state);
		const createdBy = getCurrentUser(state).slackId ?? "UDEMO001";

		const incidentState: IS = {
			id: incidentId,
			createdAt,
			status: "open",
			prompt: data.prompt,
			severity: "medium",
			createdBy,
			assignee: { slackId: entrySelection.assigneeSlackId },
			source: "dashboard",
			title,
			description: data.prompt.trim(),
			entryPointId: entrySelection.entryPoint?.id ?? "demo-entry-point",
			rotationId: entrySelection.rotationId,
			teamId: entrySelection.teamId,
		};

		const createdEvent: IncidentEvent = {
			id: state.eventSeq++,
			event_type: "INCIDENT_CREATED",
			event_data: {
				status: incidentState.status,
				severity: incidentState.severity,
				createdBy: incidentState.createdBy,
				title: incidentState.title,
				description: incidentState.description,
				prompt: incidentState.prompt,
				source: incidentState.source,
				entryPointId: incidentState.entryPointId,
				rotationId: incidentState.rotationId,
				assignee: incidentState.assignee.slackId,
			},
			created_at: createdAt.toISOString(),
			adapter: "dashboard",
		};

		const incident: DemoIncident = {
			id: incidentId,
			state: incidentState,
			context: data.channel ? { channel: data.channel, thread: `thread-${incidentId}` } : {},
			events: [createdEvent],
		};
		state.incidents.unshift(incident);
		ensureIncidentAnalysis(state, incident);

		return { id: incidentId };
	});
}

export async function getIncidentsDemo() {
	const state = await loadState();
	return getIncidentListItems(state);
}

export async function getIncidentByIdDemo(data: { id: string }) {
	const state = await loadState();
	const incident = state.incidents.find((item) => item.id === data.id);
	if (!incident || incident.state.status === "resolved") {
		return { error: "NOT_FOUND" as const };
	}
	return {
		context: incident.context,
		state: incident.state,
		events: [...incident.events],
	};
}

export async function updateAssigneeDemo(data: { id: string; slackId: string }) {
	return withState(async (state) => {
		const incident = state.incidents.find((item) => item.id === data.id);
		if (!incident) {
			throw new Error("Incident not found");
		}
		incident.state.assignee = { slackId: data.slackId };
		appendIncidentEvent(state, data.id, {
			event_type: "ASSIGNEE_UPDATE",
			event_data: {
				assignee: { slackId: data.slackId },
			},
		});

		const analysis = state.analyses.find((item) => item.id === data.id);
		if (analysis) {
			analysis.assignee = data.slackId;
		}
	});
}

export async function updateSeverityDemo(data: { id: string; severity: IS["severity"] }) {
	return withState(async (state) => {
		const incident = state.incidents.find((item) => item.id === data.id);
		if (!incident) {
			throw new Error("Incident not found");
		}
		incident.state.severity = data.severity;
		appendIncidentEvent(state, data.id, {
			event_type: "SEVERITY_UPDATE",
			event_data: { severity: data.severity },
		});

		const analysis = state.analyses.find((item) => item.id === data.id);
		if (analysis) {
			analysis.severity = data.severity;
		}
	});
}

export async function updateStatusDemo(data: { id: string; status: "mitigating" | "resolved"; message: string }) {
	return withState(async (state) => {
		const incident = state.incidents.find((item) => item.id === data.id);
		if (!incident) {
			throw new Error("Incident not found");
		}
		incident.state.status = data.status;
		appendIncidentEvent(state, data.id, {
			event_type: "STATUS_UPDATE",
			event_data: {
				status: data.status,
				message: data.message,
			},
		});

		const analysis = ensureIncidentAnalysis(state, incident);
		if (data.status === "resolved") {
			analysis.resolvedAt = new Date();
		}
	});
}

export async function sendSlackMessageDemo(data: { id: string; message: string; messageId: string; sendAsBot?: boolean }) {
	return withState(async (state) => {
		const incident = state.incidents.find((item) => item.id === data.id);
		if (!incident) {
			throw new Error("Incident not found");
		}
		const senderId = data.sendAsBot ? "fire" : (getCurrentUser(state).slackId ?? "UDEMO001");
		appendIncidentEvent(
			state,
			data.id,
			{
				event_type: "MESSAGE_ADDED",
				event_data: {
					message: data.message,
					userId: senderId,
					messageId: data.messageId,
				},
			},
			data.sendAsBot ? "fire" : "dashboard",
		);
		return { success: true };
	});
}

export async function getResolvedIncidentsDemo() {
	const state = await loadState();
	const resolved: ResolvedIncident[] = state.analyses
		.filter((analysis) => !!analysis.resolvedAt)
		.sort((a, b) => (b.resolvedAt?.getTime() ?? 0) - (a.resolvedAt?.getTime() ?? 0))
		.slice(0, MAX_RESOLVED_INCIDENTS)
		.map((analysis) => {
			const terminal = getTerminalStatusDetailsFromEvents(analysis.events);
			return {
				id: analysis.id,
				title: analysis.title,
				description: analysis.description,
				severity: analysis.severity,
				createdAt: analysis.createdAt,
				resolvedAt: analysis.resolvedAt!,
				terminalStatus: terminal.terminalStatus,
				declineReason: terminal.declineReason,
			};
		});
	return resolved;
}

export async function getAnalysisByIdDemo(data: { id: string }): Promise<GetAnalysisByIdResponse> {
	const state = await loadState();
	const analysis = state.analyses.find((item) => item.id === data.id);
	if (!analysis || !analysis.resolvedAt) {
		return null;
	}
	const terminal = getTerminalStatusDetailsFromEvents(analysis.events);
	return {
		...analysis,
		resolvedAt: analysis.resolvedAt,
		actions: [...analysis.actions],
		terminalStatus: terminal.terminalStatus,
		declineReason: terminal.declineReason,
	};
}

export async function getMetricsDemo(data: { startDate?: string; endDate?: string; teamId?: string; includeRejected?: boolean }): Promise<GetMetricsResponse> {
	const state = await loadState();
	const startDate = data.startDate ? new Date(data.startDate) : null;
	const endDate = data.endDate ? new Date(data.endDate) : null;
	const includeRejected = data.includeRejected === true;

	return state.analyses
		.filter((analysis): analysis is DemoAnalysis & { resolvedAt: Date } => !!analysis.resolvedAt)
		.filter((analysis) => !startDate || (analysis.resolvedAt && analysis.resolvedAt >= startDate))
		.filter((analysis) => !endDate || (analysis.resolvedAt && analysis.resolvedAt <= endDate))
		.filter((analysis) => !data.teamId || analysis.teamId === data.teamId)
		.sort((a, b) => (b.resolvedAt?.getTime() ?? 0) - (a.resolvedAt?.getTime() ?? 0))
		.slice(0, 100)
		.map((analysis) => {
			const entryPoint = state.entryPoints.find((entry) => entry.id === analysis.entryPointId);
			const rotation = analysis.rotationId ? state.rotations.find((candidate) => candidate.id === analysis.rotationId) : undefined;
			const terminal = getTerminalStatusDetailsFromEvents(analysis.events);
			return {
				id: analysis.id,
				title: analysis.title,
				severity: analysis.severity,
				assignee: analysis.assignee,
				createdAt: analysis.createdAt,
				resolvedAt: analysis.resolvedAt,
				metrics: computeMetricsFromEvents(analysis.events),
				entryPointId: analysis.entryPointId ?? "",
				rotationId: analysis.rotationId,
				teamId: analysis.teamId,
				entryPointPrompt: entryPoint?.prompt ?? null,
				rotationName: rotation?.name ?? null,
				terminalStatus: terminal.terminalStatus,
			};
		})
		.filter((analysis) => includeRejected || analysis.terminalStatus === "resolved")
		.map(({ terminalStatus: _terminalStatus, ...analysis }) => analysis);
}

export async function updateAnalysisImpactDemo(data: { id: string; impact: string }) {
	return withState(async (state) => {
		const analysis = state.analyses.find((item) => item.id === data.id);
		if (!analysis) {
			throw new Error("This analysis is no longer available.");
		}
		analysis.impact = normalizeString(data.impact);
		return { id: analysis.id };
	});
}

export async function updateAnalysisRootCauseDemo(data: { id: string; rootCause: string }) {
	return withState(async (state) => {
		const analysis = state.analyses.find((item) => item.id === data.id);
		if (!analysis) {
			throw new Error("This analysis is no longer available.");
		}
		analysis.rootCause = normalizeString(data.rootCause);
		return { id: analysis.id };
	});
}

export async function updateAnalysisTimelineDemo(data: { id: string; timeline: { created_at: string; text: string }[] }) {
	return withState(async (state) => {
		const analysis = state.analyses.find((item) => item.id === data.id);
		if (!analysis) {
			throw new Error("This analysis is no longer available.");
		}
		analysis.timeline = data.timeline.filter((item) => item.text.trim().length > 0).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
		return { id: analysis.id };
	});
}

export async function updateIncidentActionDemo(data: { id: string; description: string }) {
	return withState(async (state) => {
		for (const analysis of state.analyses) {
			const action = analysis.actions.find((candidate) => candidate.id === data.id);
			if (action) {
				action.description = data.description.trim();
				return { id: action.id, incidentId: analysis.id };
			}
		}
		throw new Error("This action no longer exists.");
	});
}

export async function deleteIncidentActionDemo(data: { id: string }) {
	return withState(async (state) => {
		for (const analysis of state.analyses) {
			const before = analysis.actions.length;
			analysis.actions = analysis.actions.filter((action) => action.id !== data.id);
			if (analysis.actions.length < before) {
				return { id: data.id };
			}
		}
		throw new Error("This action no longer exists.");
	});
}

export async function createIncidentActionDemo(data: { incidentId: string; description: string }) {
	return withState(async (state) => {
		const analysis = state.analyses.find((item) => item.id === data.incidentId);
		if (!analysis) {
			throw new Error("This incident is no longer available.");
		}
		const action: IncidentAction = {
			id: makeId("action"),
			description: data.description.trim(),
		};
		analysis.actions.push(action);
		return action;
	});
}

function affectionCurrentStatus(affection: DemoAffection): AffectionStatus {
	const lastWithStatus = [...affection.updates].reverse().find((update) => !!update.status);
	return (lastWithStatus?.status ?? "investigating") as AffectionStatus;
}

function affectionLastUpdate(affection: DemoAffection) {
	return affection.updates.length > 0 ? affection.updates[affection.updates.length - 1]! : null;
}

function affectionToResponse(state: DemoState, affection: DemoAffection): IncidentAffectionData {
	return {
		id: affection.id,
		incidentId: affection.incidentId,
		title: affection.title,
		createdAt: affection.createdAt,
		updatedAt: affection.updatedAt,
		resolvedAt: affection.resolvedAt,
		currentStatus: affectionCurrentStatus(affection),
		services: affection.services
			.map((entry) => {
				const service = state.services.find((candidate) => candidate.id === entry.id);
				if (!service) {
					return null;
				}
				return {
					id: service.id,
					name: service.name,
					imageUrl: service.imageUrl,
					impact: entry.impact,
				};
			})
			.filter((service): service is NonNullable<typeof service> => !!service),
		lastUpdate: affectionLastUpdate(affection),
	};
}

export async function getIncidentAffectionDemo(data: { incidentId: string }) {
	const state = await loadState();
	const affection = state.affections.find((item) => item.incidentId === data.incidentId);
	if (!affection) {
		return null;
	}
	return affectionToResponse(state, affection);
}

export async function createIncidentAffectionDemo(data: { incidentId: string; title: string; services: { id: string; impact: AffectionImpact }[]; initialMessage: string }) {
	return withState(async (state) => {
		const incident = state.incidents.find((item) => item.id === data.incidentId);
		if (!incident) {
			throw new Error("Incident not found");
		}
		const affection: DemoAffection = {
			id: makeId("affection"),
			incidentId: data.incidentId,
			title: data.title.trim(),
			createdAt: new Date(),
			updatedAt: new Date(),
			resolvedAt: null,
			services: ensureUniqueStrings(data.services.map((service) => service.id)).map((id) => {
				const service = data.services.find((entry) => entry.id === id)!;
				return { id, impact: service.impact };
			}),
			updates: [
				{
					id: makeId("affection-update"),
					status: "investigating",
					message: data.initialMessage.trim(),
					createdAt: new Date(),
					createdBy: getCurrentUser(state).id,
				},
			],
		};
		state.affections = state.affections.filter((item) => item.incidentId !== data.incidentId);
		state.affections.push(affection);
		appendIncidentEvent(state, incident.id, {
			event_type: "AFFECTION_UPDATE",
			event_data: {
				title: affection.title,
				services: affection.services,
				status: "investigating",
				message: data.initialMessage.trim(),
				createdBy: getCurrentUser(state).id,
			},
		});
		return { success: true };
	});
}

export async function addIncidentAffectionUpdateDemo(data: { incidentId: string; status?: AffectionStatus; message: string }) {
	return withState(async (state) => {
		const affection = state.affections.find((item) => item.incidentId === data.incidentId);
		if (!affection) {
			throw new Error("Affection not found");
		}
		const update: DemoAffectionUpdate = {
			id: makeId("affection-update"),
			status: data.status ?? null,
			message: data.message.trim(),
			createdAt: new Date(),
			createdBy: getCurrentUser(state).id,
		};
		affection.updates.push(update);
		affection.updatedAt = new Date();
		if (data.status === "resolved") {
			affection.resolvedAt = new Date();
		}
		appendIncidentEvent(state, data.incidentId, {
			event_type: "AFFECTION_UPDATE",
			event_data: {
				message: update.message ?? "",
				status: data.status,
				createdBy: getCurrentUser(state).id,
			},
		});
		return { success: true };
	});
}

export async function updateIncidentAffectionServicesDemo(data: { affectionId: string; services: { id: string; impact: AffectionImpact }[] }) {
	return withState(async (state) => {
		const affection = state.affections.find((item) => item.id === data.affectionId);
		if (!affection) {
			throw new Error("Affection not found");
		}
		affection.services = ensureUniqueStrings(data.services.map((service) => service.id)).map((id) => {
			const service = data.services.find((entry) => entry.id === id)!;
			return { id, impact: service.impact };
		});
		affection.updatedAt = new Date();
		return { success: true };
	});
}

export async function getNotionPagesDemo(data: { query?: string }) {
	const state = await loadState();
	const query = (data.query ?? "").trim().toLowerCase();
	if (!query) {
		return [...state.notionPages];
	}
	return state.notionPages.filter((page) => page.title.toLowerCase().includes(query));
}

export async function exportToNotionDemo(_data: { incidentId: string; parentPageId: string }) {
	throw new Error("Export to Notion is not supported in demo mode yet.");
}
