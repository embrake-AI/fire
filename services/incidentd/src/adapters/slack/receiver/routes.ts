import type { IS } from "@fire/common";
import type { Context } from "hono";
import { Hono } from "hono";
import { type AuthContext, startIncident, updateAssignee, updateSeverity, updateStatus } from "../../../handler/index";
import { ASSERT_NEVER } from "../../../lib/utils";
import { verifySlackRequestMiddleware } from "./middleware";
import { getSlackIntegration, handleStatusUpdate, type SlackEventPayload, type SlackInteractionPayload } from "./utils";

type SlackContext = { Bindings: Env };

const slackRoutes = new Hono<SlackContext>().use(verifySlackRequestMiddleware);

slackRoutes.post("/events", async (c) => {
	const body = await c.req.json<SlackEventPayload>();

	if (body.type === "url_verification") {
		return c.text(body.challenge);
	}

	if (body.type === "event_callback") {
		const event = body.event;

		if (event.type === "app_mention") {
			if (event.subtype === "bot_message") {
				return c.text("OK");
			}

			//If edited, contains: "edited": { "user": "user_id", "ts": "ts" },
			if (event.thread_ts) {
				// either thread_ts === ts => the message was edited
				// or thread_ts !== ts => the message was a new message in the thread
				// TODO: handle mentions as prompts
				return c.text("OK");
			}

			const text = event.text as string;
			const user = event.user;
			const thread = event.thread_ts ?? event.ts;
			const teamId = body.team_id ?? event.team;
			const enterpriseId = body.enterprise_id ?? null;
			const isEnterpriseInstall = body.is_enterprise_install ?? false;
			const channel = event.channel;
			const prompt = text.replace(/<@[^>]+>\s*/g, "").trim();

			if (!teamId) {
				console.error("No team_id found in event payload");
				return c.text("OK");
			}

			const slackIntegration = await getSlackIntegration({
				hyperdrive: c.env.db,
				teamId,
				enterpriseId,
				isEnterpriseInstall,
			});

			if (!slackIntegration) {
				console.error(`No Slack integration found for team ${teamId}`);
				return c.text("OK");
			}

			const { clientId, data: integrationData } = slackIntegration;
			c.set("auth", { clientId });

			const botToken = integrationData.botToken;

			c.executionCtx.waitUntil(
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
				}).catch(() => {}),
			);

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
		}

		return c.text("OK");
	}

	return c.text("OK");
});

slackRoutes.post("/interaction", async (c) => {
	const body = await c.req.parseBody<{ payload: string }>();
	const payload = JSON.parse(body.payload) as SlackInteractionPayload;
	const teamId = payload.team.id;
	const enterpriseId = payload.team.enterprise_id ?? null;

	if (payload.type === "view_submission") {
		if (payload.view.callback_id !== "status_update_modal") {
			return c.text("OK");
		}
		const privateMetadata = JSON.parse(payload.view.private_metadata) as {
			incidentId: string;
			newStatus: Exclude<IS["status"], "open">;
		};
		const { incidentId, newStatus } = privateMetadata;
		const statusMessage = payload.view.state.values.status_message_block.status_message_input.value ?? "";

		await updateStatus({
			c,
			id: incidentId,
			status: newStatus,
			message: statusMessage,
		});

		return c.json({});
	} else if (payload.type === "block_actions") {
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
			} else if (action.type === "static_select" && action.action_id === "set_status") {
				const triggerId = payload.trigger_id;
				await handleStatusUpdate(c, action, {
					incidentId,
					teamId,
					enterpriseId,
					triggerId,
				});
			} else {
				ASSERT_NEVER(action);
			}
		}
	}

	return c.text("OK");
});

export { slackRoutes };
