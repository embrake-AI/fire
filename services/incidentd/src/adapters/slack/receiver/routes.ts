import type { IS } from "@fire/common";
import { integration, type SlackIntegrationData } from "@fire/db/schema";
import type { KnownBlock, SlackEvent } from "@slack/types";
import { sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { type AuthContext, startIncident, updateAssignee, updateSeverity } from "../../../handler/index";
import { getDB } from "../../../lib/db";
import { ASSERT_NEVER } from "../../../lib/utils";
import { verifySlackRequestMiddleware } from "./middleware";

type SlackContext = { Bindings: Env } & {};

const slackRoutes = new Hono<SlackContext>().use(verifySlackRequestMiddleware);

slackRoutes.post("/events", async (c) => {
	const body = await c.req.json<SlackEventPayload>();
	if (body.type === "event_callback") {
		const event = body.event;

		if (event.type === "app_mention") {
			if (event.subtype === "bot_message") {
				return c.text("OK");
			}
			const text = event.text as string; // includes the mention like "<@U123> prompt"
			const user = event.user;
			const thread = event.thread_ts ?? event.ts;
			const teamId = body.team_id ?? event.team;
			const enterpriseId = body.enterprise_id ?? null;
			const isEnterpriseInstall = body.is_enterprise_install ?? false;
			const channel = event.channel;

			const prompt = text.replace(/<@[^>]+>\s*/g, "").trim();

			if (!teamId) {
				console.error("No team_id found in event payload");
				return;
			}

			const slackIntegration = await getSlackIntegration({
				hyperdrive: c.env.db,
				teamId,
				enterpriseId,
				isEnterpriseInstall,
			});

			if (!slackIntegration) {
				console.error(`No Slack integration found for team ${teamId}`);
				return;
			}

			const { clientId, data: integrationData } = slackIntegration;
			c.set("auth", { clientId });

			const botToken = integrationData.botToken;

			// It's okay if the reaction is not added successfully, as it's not critical to the incident creation.
			fetch(`https://slack.com/api/reactions.add`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${botToken}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					name: "fire",
					channel,
					timestamp: thread,
				}),
			}).catch(() => {});
			await startIncident({
				c: c as Context<AuthContext>,
				identifier: thread,
				prompt,
				createdBy: user,
				source: "slack",
				m: {
					botToken,
					channel,
					thread,
				},
			});
		} else if (event.type === "message") {
			/**
			 * Check if relevant
			 * Update
			 */
		}

		return c.text("OK");
	} else if (body.type === "url_verification") {
		return c.text(body.challenge);
	}

	return c.text("OK");
});

slackRoutes.post("/interaction", async (c) => {
	const body = await c.req.parseBody<{ payload: string }>();
	const payload = JSON.parse(body.payload) as SlackBlockActionPayload;
	for (const action of payload.actions) {
		const incidentId = action.block_id.split(":")[1];
		if (!incidentId) {
			throw new Error("Incident ID not found");
		}
		if (action.type === "static_select" && action.action_id === "set_severity") {
			await updateSeverity({
				c,
				id: incidentId,
				severity: action.selected_option.value,
			});
		} else if (action.type === "users_select" && action.action_id === "set_assignee") {
			await updateAssignee({
				c,
				id: incidentId,
				assignee: action.selected_user,
			});
		} else {
			ASSERT_NEVER(action);
		}
	}
	return c.text("OK");
});

export { slackRoutes };

type SlackEventPayload =
	| { type: "url_verification"; challenge: string }
	| {
			type: "event_callback";
			team_id?: string;
			enterprise_id?: string;
			is_enterprise_install?: boolean;
			event: SlackEvent;
	  };

/**
 * Look up a Slack integration by workspace (team_id).
 *
 * Uses team_id as the primary tenant identifier since it's the most stable
 * identifier for a Slack workspace. For Enterprise Grid org-level installs,
 * also matches on enterprise_id.
 *
 * Note: We don't key on bot_id because:
 * - It's not present on many event types (including human-origin app_mentions)
 * - It identifies the bot, not the tenant/workspace
 * - It varies across installation types and payload variants
 */
async function getSlackIntegration(opts: {
	hyperdrive: Hyperdrive;
	teamId: string;
	enterpriseId?: string | null;
	isEnterpriseInstall?: boolean;
}): Promise<{ clientId: string; data: SlackIntegrationData } | null> {
	const { hyperdrive, teamId, enterpriseId, isEnterpriseInstall = false } = opts;
	const db = getDB(hyperdrive);

	const [result] = await db
		.select({ clientId: integration.clientId, data: integration.data })
		.from(integration)
		.where(
			sql`
				${integration.data}->>'teamId' = ${teamId}
				AND (
					${!isEnterpriseInstall}
					OR ${integration.data}->>'enterpriseId' = ${enterpriseId}
				)
			`,
		)
		.limit(1);

	return result ?? null;
}

type SlackBlockActionPayload = {
	type: "block_actions";
	user: {
		id: string;
		username?: string;
	};
	channel?: {
		id: string;
		name?: string;
	};
	message?: {
		ts: string;
		blocks?: KnownBlock[];
	};
	container?: {
		type: "message" | "view";
		message_ts?: string;
		block_id?: string;
	};
	actions: Array<
		| {
				type: "static_select";
				action_id: "set_severity";
				block_id: string;
				selected_option: {
					text: { type: "plain_text"; text: string };
					value: IS["severity"];
				};
		  }
		| {
				type: "users_select";
				action_id: "set_assignee";
				block_id: string;
				selected_user: string;
		  }
	>;
};
