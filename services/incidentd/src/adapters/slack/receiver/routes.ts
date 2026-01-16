import type { IS } from "@fire/common";
import type { Context } from "hono";
import { Hono } from "hono";
import { type AuthContext, addMessage, startIncident, updateAssignee, updateSeverity, updateStatus } from "../../../handler/index";
import { ASSERT_NEVER } from "../../../lib/utils";
import { extractIdentifierFromChannelName, normalizeIncidentIdentifier } from "../shared";
import { verifySlackRequestMiddleware } from "./middleware";
import { getChannelInfo, getIncidentIdFromMessageMetadata, getSlackIntegration, handleStatusUpdate, type SlackEventPayload, type SlackInteractionPayload } from "./utils";

type SlackContext = { Bindings: Env };

const slackRoutes = new Hono<SlackContext>().use(verifySlackRequestMiddleware);

slackRoutes.post("/events", async (c) => {
	const body = await c.req.json<SlackEventPayload>();

	if (body.type === "url_verification") {
		return c.text(body.challenge);
	}

	if (body.type === "event_callback") {
		const event = body.event;
		const enterpriseId = body.enterprise_id ?? null;
		const isEnterpriseInstall = body.is_enterprise_install ?? false;

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

			const text = event.text;
			const user = event.user!; // It's not a bot message, so user is required
			const thread = event.thread_ts ?? event.ts;
			const identifier = normalizeIncidentIdentifier(thread);
			const teamId = body.team_id ?? event.team;

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
				withEntryPoints: true,
			});

			if (!slackIntegration) {
				console.error(`No Slack integration found for ${teamId}`);
				return c.text("OK");
			}
			if (!slackIntegration.entryPoints.length) {
				console.error(`No entry points found for client ${slackIntegration.clientId}`);
				return c.text("OK");
			}

			const { clientId, data: integrationData } = slackIntegration;
			c.set("auth", { clientId });

			const botToken = integrationData.botToken;
			const channelInfo = await getChannelInfo({
				botToken,
				channelId: channel,
			});
			if (channelInfo) {
				const incidentId = extractIdentifierFromChannelName(channelInfo.name);
				if (incidentId) {
					return c.text("OK");
				}
			}

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
				identifier,
				prompt,
				createdBy: user,
				source: "slack",
				m: {
					botToken,
					channel,
					thread,
				},
				entryPoints: slackIntegration.entryPoints,
			});
		} else if (event.type === "message" && (event.channel_type === "channel" || event.channel_type === "group")) {
			// hard-coding the type copied from testing. Not sure why types differ.
			const message = event as {
				user: string;
				bot_id?: string;
				ts: string;
				text: string;
				team: string;
				thread_ts?: string;
				parent_user_id?: string;
				channel: string;
			};

			const text = message.text;
			const user = message.user;
			const thread = message.thread_ts;
			const channel = event.channel;
			const teamId = body.team_id ?? message.team;

			if (!text || !user || !teamId || !channel) {
				return c.text("OK");
			}

			const slackIntegration = await getSlackIntegration({
				hyperdrive: c.env.db,
				teamId,
				enterpriseId,
				isEnterpriseInstall,
				withEntryPoints: false,
			});
			if (!slackIntegration) {
				console.error(`No Slack integration found for ${teamId}`);
				return c.text("OK");
			}

			// For now, we ignore all bot messages. We could filter by our specific bot
			if (message.user === slackIntegration.data.botUserId || message.bot_id) {
				return c.text("OK");
			}

			// Ignore system messages like "X has joined the channel"
			if (event.subtype) {
				return c.text("OK");
			}

			if (thread) {
				const botOriginated = message.parent_user_id && message.parent_user_id === slackIntegration.data.botUserId;
				if (botOriginated) {
					const incidentIdFromMetadata = await getIncidentIdFromMessageMetadata({
						botToken: slackIntegration.data.botToken,
						channel,
						messageTs: thread,
					});
					if (incidentIdFromMetadata) {
						await addMessage({
							c: c as Context<AuthContext>,
							id: incidentIdFromMetadata,
							message: text,
							userId: user,
							messageId: message.ts,
							adapter: "slack",
						});
					}
				} else {
					const identifier = normalizeIncidentIdentifier(thread);
					await addMessage({
						c: c as Context<AuthContext>,
						identifier,
						message: text,
						userId: user,
						messageId: message.ts,
						adapter: "slack",
					});
				}
			} else {
				const channelInfo = await getChannelInfo({
					botToken: slackIntegration.data.botToken,
					channelId: channel,
				});
				if (channelInfo) {
					const identifier = extractIdentifierFromChannelName(channelInfo.name);
					if (identifier) {
						await addMessage({
							c: c as Context<AuthContext>,
							identifier,
							message: text,
							userId: user,
							messageId: message.ts,
							adapter: "slack",
						});
					}
				}
			}
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
			adapter: "slack",
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
					adapter: "slack",
				});
			} else if (action.type === "users_select" && action.action_id === "set_assignee") {
				await updateAssignee({
					c,
					id: incidentId,
					assignee: {
						slackId: action.selected_user,
					},
					adapter: "slack",
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
