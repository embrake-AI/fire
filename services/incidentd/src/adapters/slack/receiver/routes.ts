import type { IS } from "@fire/common";
import type { Context } from "hono";
import { Hono } from "hono";
import { type AuthContext, addMessage, addPrompt, startIncident, updateAffection, updateAssignee, updateSeverity, updateStatus } from "../../../handler/index";
import { ASSERT_NEVER } from "../../../lib/utils";
import { addReaction, incidentChannelIdentifier, slackThreadIdentifier } from "../shared";
import { verifySlackRequestMiddleware } from "./middleware";
import {
	getIncidentIdFromIdentifier,
	getIncidentIdFromMessageMetadata,
	getSlackIntegration,
	handleStatusUpdate,
	openAgentSuggestionModal,
	parseAgentSuggestionPayload,
	type SlackEventPayload,
	type SlackInteractionPayload,
} from "./utils";

type SlackContext = { Bindings: Env };

const slackRoutes = new Hono<SlackContext>().use(verifySlackRequestMiddleware);

slackRoutes.post("/events", async (c) => {
	try {
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

				const text = event.text;
				const user = event.user!; // It's not a bot message, so user is required
				const promptThread = event.thread_ts ?? null;
				const teamId = body.team_id ?? event.team;

				const channel = event.channel;
				const prompt = text.replace(/<@[^>]+>\s*/g, "").trim();

				if (!teamId) {
					console.error("No team_id found in event payload");
					return c.text("OK");
				}

				const [slackIntegration, incidentIdForChannel] = await Promise.all([
					getSlackIntegration({
						hyperdrive: c.env.db,
						teamId,
						enterpriseId,
						isEnterpriseInstall,
						withEntryPoints: true,
					}),
					getIncidentIdFromIdentifier({
						incidents: c.env.incidents,
						identifier: incidentChannelIdentifier(channel),
					}),
				]);

				if (!slackIntegration) {
					console.error(`No Slack integration found for ${teamId}`);
					return c.text("OK");
				}
				const { clientId, data: integrationData, services } = slackIntegration;
				c.set("auth", { clientId });

				const botToken = integrationData.botToken;

				const isThread = !!promptThread && promptThread !== event.ts;
				if (incidentIdForChannel) {
					await addPrompt({
						c: c as Context<AuthContext>,
						id: incidentIdForChannel,
						prompt,
						userId: user,
						ts: event.ts,
						channel,
						threadTs: promptThread ?? event.ts,
						adapter: "slack",
					});
					return c.text("OK");
				}
				if (isThread) {
					const identifier = slackThreadIdentifier(channel, promptThread);
					const incidentId = await getIncidentIdFromIdentifier({
						incidents: c.env.incidents,
						identifier,
					});
					if (incidentId) {
						await addPrompt({
							c: c as Context<AuthContext>,
							id: incidentId,
							prompt,
							userId: user,
							ts: event.ts,
							channel,
							threadTs: promptThread,
							adapter: "slack",
						});
					}
					return c.text("OK");
				}

				if (!slackIntegration.entryPoints.length) {
					console.error(`No entry points found for client ${slackIntegration.clientId}`);
					return c.text("OK");
				}

				const threadForIncident = event.ts;
				const isRetry = c.req.header("x-slack-retry-num") !== undefined;
				if (!isRetry) {
					c.executionCtx.waitUntil(addReaction(botToken, channel, threadForIncident, "fire"));
				}

				await startIncident({
					c: c as Context<AuthContext>,
					identifier: threadForIncident,
					prompt,
					createdBy: user,
					source: "slack",
					m: {
						botToken,
						channel,
						thread: threadForIncident,
					},
					entryPoints: slackIntegration.entryPoints,
					services,
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
						const identifier = thread;
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
					const incidentId = await getIncidentIdFromIdentifier({
						incidents: c.env.incidents,
						identifier: incidentChannelIdentifier(channel),
					});
					if (incidentId) {
						await addMessage({
							c: c as Context<AuthContext>,
							id: incidentId,
							message: text,
							userId: user,
							messageId: message.ts,
							adapter: "slack",
						});
					}
				}
			}

			return c.text("OK");
		}

		return c.text("OK");
	} catch (error) {
		console.error("Slack /events handler error", error);
		return c.text("OK");
	}
});

slackRoutes.post("/interaction", async (c) => {
	try {
		const body = await c.req.parseBody<{ payload: string }>();
		const payload = JSON.parse(body.payload) as SlackInteractionPayload;
		const teamId = payload.team.id;
		const enterpriseId = payload.team.enterprise_id ?? null;

		if (payload.type === "view_submission") {
			if (payload.view.callback_id === "status_update_modal") {
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
			}

			if (payload.view.callback_id === "agent_suggestion_edit") {
				const suggestion = parseAgentSuggestionPayload(payload.view.private_metadata);
				if (!suggestion) {
					return c.text("OK");
				}

				const values = payload.view.state.values;
				const messageValue = values.agent_message_block?.agent_message_input?.value ?? values.status_message_block?.status_message_input?.value ?? "";

				if (suggestion.action === "update_status") {
					if (!messageValue) {
						return c.text("OK");
					}
					await updateStatus({
						c,
						id: suggestion.incidentId,
						status: suggestion.status,
						message: messageValue,
						adapter: "slack",
						eventMetadata: { agentSuggestionId: suggestion.suggestionId },
					});
					return c.json({});
				}

				if (suggestion.action === "add_status_page_update") {
					if (!messageValue) {
						return c.text("OK");
					}
					const selectedStatus = values.agent_status_block?.agent_status_select?.selected_option?.value;
					const affectionStatus =
						selectedStatus && ["investigating", "mitigating", "resolved"].includes(selectedStatus)
							? (selectedStatus as "investigating" | "mitigating" | "resolved")
							: suggestion.affectionStatus;

					await updateAffection({
						c,
						id: suggestion.incidentId,
						adapter: "slack",
						update: {
							message: messageValue,
							createdBy: payload.user.id,
							...(affectionStatus ? { status: affectionStatus } : {}),
							...(suggestion.title ? { title: suggestion.title } : {}),
							...(suggestion.services ? { services: suggestion.services } : {}),
						},
						eventMetadata: { agentSuggestionId: suggestion.suggestionId },
					});

					return c.json({});
				}

				return c.text("OK");
			}

			return c.text("OK");
		} else if (payload.type === "block_actions") {
			for (const action of payload.actions) {
				if (action.type === "button") {
					if (action.action_id === "agent_apply") {
						const suggestion = parseAgentSuggestionPayload(action.value);
						if (!suggestion) {
							continue;
						}

						if (suggestion.action === "update_status") {
							await updateStatus({
								c,
								id: suggestion.incidentId,
								status: suggestion.status,
								message: suggestion.message,
								adapter: "slack",
								eventMetadata: { agentSuggestionId: suggestion.suggestionId },
							});
						} else if (suggestion.action === "update_severity") {
							await updateSeverity({
								c,
								id: suggestion.incidentId,
								severity: suggestion.severity,
								adapter: "slack",
								eventMetadata: { agentSuggestionId: suggestion.suggestionId },
							});
						} else if (suggestion.action === "add_status_page_update") {
							await updateAffection({
								c,
								id: suggestion.incidentId,
								adapter: "slack",
								update: {
									message: suggestion.message,
									createdBy: payload.user.id,
									...(suggestion.affectionStatus ? { status: suggestion.affectionStatus } : {}),
									...(suggestion.title ? { title: suggestion.title } : {}),
									...(suggestion.services ? { services: suggestion.services } : {}),
								},
								eventMetadata: { agentSuggestionId: suggestion.suggestionId },
							});
						}
						continue;
					}

					if (action.action_id === "agent_edit") {
						const suggestion = parseAgentSuggestionPayload(action.value);
						if (!suggestion) {
							continue;
						}

						const slackIntegration = await getSlackIntegration({
							hyperdrive: c.env.db,
							teamId,
							enterpriseId,
							isEnterpriseInstall: !!enterpriseId,
							withEntryPoints: false,
						});
						if (!slackIntegration) {
							console.error(`No Slack integration found for team ${teamId}`);
							continue;
						}

						await openAgentSuggestionModal({
							botToken: slackIntegration.data.botToken,
							triggerId: payload.trigger_id,
							suggestion,
						});
					}
					continue;
				}

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
	} catch (error) {
		console.error("Slack /interaction handler error", error);
		return c.text("OK");
	}
});

export { slackRoutes };
