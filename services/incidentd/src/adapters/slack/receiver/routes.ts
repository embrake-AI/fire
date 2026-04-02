import type { IS } from "@fire/common";
import type { KnownBlock } from "@slack/types";
import { Hono } from "hono";
import { parseAgentSuggestionPayload } from "../../../agent/slack";
import { addMessage, addPrompt, startIncident, updateAffection, updateAssignee, updateSeverity, updateStatus } from "../../../handler/index";
import { getIncidentIdByIdentifiers } from "../../../lib/incident-identifiers";
import { addReaction, incidentChannelIdentifier, slackThreadIdentifier } from "../../../lib/slack";
import { ASSERT_NEVER } from "../../../lib/utils";
import { verifySlackRequestMiddleware } from "./middleware";
import {
	buildThreadIncidentPrompt,
	extractSlackMessageText,
	fetchSlackThreadMessages,
	getIncidentIdFromMessageMetadata,
	getSlackActorId,
	getSlackIntegration,
	handleStatusUpdate,
	isSlackEventFromFire,
	openAgentSuggestionModal,
	postNoEntryPointsConfiguredMessage,
	type SlackEventPayload,
	type SlackInteractionPayload,
} from "./utils";

type SlackContext = { Bindings: Env };

const slackRoutes = new Hono<SlackContext>().use(verifySlackRequestMiddleware);

slackRoutes.post("/events", async (c) => {
	try {
		const body = await c.req.json<SlackEventPayload>();
		console.log(JSON.stringify(body));

		if (body.type === "url_verification") {
			return c.text(body.challenge);
		}

		if (body.type === "event_callback") {
			const event = body.event;
			const enterpriseId = body.enterprise_id ?? null;
			const isEnterpriseInstall = body.is_enterprise_install ?? false;

			if (event.type === "app_mention") {
				const mentionEvent = event as typeof event & {
					user?: string;
					bot_id?: string;
					app_id?: string;
					bot_profile?: {
						app_id?: string;
					} | null;
					attachments?: Array<{
						fallback?: string;
						pretext?: string;
						text?: string;
						footer?: string;
						fields?: Array<{ title?: string; value?: string }> | null;
					}>;
					blocks?: KnownBlock[];
				};

				const text = extractSlackMessageText(event.text, mentionEvent.attachments, mentionEvent.blocks);
				const promptThread = event.thread_ts ?? null;
				const teamId = body.team_id ?? event.team;

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
				const { clientId, data: integrationData, services } = slackIntegration;
				if (isSlackEventFromFire(mentionEvent, integrationData)) {
					console.log("event is from fire");
					return c.text("OK");
				}
				const user = getSlackActorId(mentionEvent);
				const channel = event.channel;
				if (!text || !user || !channel) {
					console.log("missing text, user, channel", {
						text,
						user,
						channel,
					});
					return c.text("OK");
				}
				c.set("auth", { clientId });
				const incidentIdForChannel = await getIncidentIdByIdentifiers({
					incidents: c.env.incidents,
					clientId,
					identifiers: [incidentChannelIdentifier(channel)],
				});

				const botToken = integrationData.botToken;
				const prompt = text.replace(/<@[^>]+>\s*/g, "").trim();

				const isThread = !!promptThread && promptThread !== event.ts;
				if (incidentIdForChannel) {
					await addPrompt({
						c,
						idOrIdentifier: { id: incidentIdForChannel },
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
					const incidentId = await getIncidentIdByIdentifiers({
						incidents: c.env.incidents,
						clientId,
						identifiers: [slackThreadIdentifier(channel, promptThread), promptThread],
					});
					if (incidentId) {
						await addPrompt({
							c,
							idOrIdentifier: { id: incidentId },
							prompt,
							userId: user,
							ts: event.ts,
							channel,
							threadTs: promptThread,
							adapter: "slack",
						});
						return c.text("OK");
					}

					if (!slackIntegration.entryPoints.length) {
						console.error(`No entry points found for client ${slackIntegration.clientId}`);
						c.executionCtx.waitUntil(
							postNoEntryPointsConfiguredMessage({
								botToken,
								channel,
								threadTs: promptThread,
								frontendUrl: c.env.FRONTEND_URL,
							}),
						);
						return c.text("OK");
					}

					const threadMessages = await fetchSlackThreadMessages({
						botToken,
						channel,
						threadTs: promptThread,
					});
					if (!threadMessages?.length) {
						await addReaction(botToken, channel, event.ts, "warning");
						return c.text("OK");
					}

					const threadPrompt = buildThreadIncidentPrompt({
						channel,
						threadTs: promptThread,
						mentionTs: event.ts,
						mentionUserId: user,
						mentionCommandText: prompt,
						messages: threadMessages,
					});

					const threadForIncident = promptThread;
					const incidentIdentifier = slackThreadIdentifier(channel, threadForIncident);
					const isRetry = c.req.header("x-slack-retry-num") !== undefined;
					if (!isRetry) {
						c.executionCtx.waitUntil(addReaction(botToken, channel, threadForIncident, "fire"));
					}

					await startIncident({
						c,
						clientId,
						identifier: incidentIdentifier,
						prompt: threadPrompt,
						createdBy: user,
						source: "slack",
						m: {
							botToken,
							channel,
							thread: threadForIncident,
						},
						entryPoints: slackIntegration.entryPoints,
						services,
						bootstrapMessages: threadMessages.map((message) => ({
							message: message.text,
							userId: message.userId,
							messageId: message.messageId,
							createdAt: message.createdAtIso,
						})),
					});
					return c.text("OK");
				}

				if (!slackIntegration.entryPoints.length) {
					console.error(`No entry points found for client ${slackIntegration.clientId}`);
					c.executionCtx.waitUntil(
						postNoEntryPointsConfiguredMessage({
							botToken,
							channel,
							threadTs: event.ts,
							frontendUrl: c.env.FRONTEND_URL,
						}),
					);
					return c.text("OK");
				}

				const threadForIncident = event.ts;
				const incidentIdentifier = slackThreadIdentifier(channel, threadForIncident);
				const isRetry = c.req.header("x-slack-retry-num") !== undefined;
				if (!isRetry) {
					c.executionCtx.waitUntil(addReaction(botToken, channel, threadForIncident, "fire"));
				}

				await startIncident({
					c,
					clientId,
					identifier: incidentIdentifier,
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
					app_id?: string;
					bot_profile?: {
						app_id?: string;
					} | null;
					ts: string;
					text: string;
					attachments?: Array<{
						fallback?: string;
						pretext?: string;
						text?: string;
						footer?: string;
						fields?: Array<{ title?: string; value?: string }> | null;
					}>;
					blocks?: KnownBlock[];
					team: string;
					thread_ts?: string;
					parent_user_id?: string;
					channel: string;
				};

				const text = extractSlackMessageText(message.text, message.attachments, message.blocks);
				const user = getSlackActorId(message);
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

				if (isSlackEventFromFire(message, slackIntegration.data)) {
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
								c,
								idOrIdentifier: { id: incidentIdFromMetadata },
								message: text,
								userId: user,
								messageId: message.ts,
								adapter: "slack",
							});
						}
					} else {
						const identifier = slackThreadIdentifier(channel, thread);
						await addMessage({
							c,
							idOrIdentifier: { identifier, clientId: slackIntegration.clientId },
							message: text,
							userId: user,
							messageId: message.ts,
							adapter: "slack",
						});
					}
				} else {
					const incidentId = await getIncidentIdByIdentifiers({
						incidents: c.env.incidents,
						clientId: slackIntegration.clientId,
						identifiers: [incidentChannelIdentifier(channel)],
					});
					if (incidentId) {
						await addMessage({
							c,
							idOrIdentifier: { id: incidentId },
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
					const suggestionMetadata: Record<string, string> = { agentSuggestionId: suggestion.suggestionId };
					if (suggestion.messageChannel && suggestion.messageTs && suggestion.messageBlocks) {
						suggestionMetadata.suggestionMessageChannel = suggestion.messageChannel;
						suggestionMetadata.suggestionMessageTs = suggestion.messageTs;
						suggestionMetadata.suggestionMessageBlocks = JSON.stringify(suggestion.messageBlocks);
					}
					await updateStatus({
						c,
						id: suggestion.incidentId,
						status: suggestion.status,
						message: messageValue,
						adapter: "slack",
						eventMetadata: suggestionMetadata,
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

					const suggestionMetadata: Record<string, string> = { agentSuggestionId: suggestion.suggestionId };
					if (suggestion.messageChannel && suggestion.messageTs && suggestion.messageBlocks) {
						suggestionMetadata.suggestionMessageChannel = suggestion.messageChannel;
						suggestionMetadata.suggestionMessageTs = suggestion.messageTs;
						suggestionMetadata.suggestionMessageBlocks = JSON.stringify(suggestion.messageBlocks);
					}
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
						eventMetadata: suggestionMetadata,
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
						const suggestionChannel = payload.channel?.id;
						const suggestionTs = payload.message?.ts ?? payload.container?.message_ts;
						const suggestionBlocks = payload.message?.blocks;
						const suggestionMetadata: Record<string, string> = { agentSuggestionId: suggestion.suggestionId };
						if (suggestionChannel && suggestionTs && suggestionBlocks) {
							suggestionMetadata.suggestionMessageChannel = suggestionChannel;
							suggestionMetadata.suggestionMessageTs = suggestionTs;
							suggestionMetadata.suggestionMessageBlocks = JSON.stringify(suggestionBlocks);
						}

						if (suggestion.action === "update_status") {
							await updateStatus({
								c,
								id: suggestion.incidentId,
								status: suggestion.status,
								message: suggestion.message,
								adapter: "slack",
								eventMetadata: suggestionMetadata,
							});
						} else if (suggestion.action === "update_severity") {
							await updateSeverity({
								c,
								id: suggestion.incidentId,
								severity: suggestion.severity,
								adapter: "slack",
								eventMetadata: suggestionMetadata,
							});
						} else if (suggestion.action === "add_status_page_update") {
							const result = await updateAffection({
								c,
								id: suggestion.incidentId,
								adapter: "slack",
								update: {
									message: suggestion.publicMessage,
									createdBy: payload.user.id,
									...(suggestion.affectionStatus ? { status: suggestion.affectionStatus } : {}),
									...(suggestion.title ? { title: suggestion.title } : {}),
									...(suggestion.services ? { services: suggestion.services } : {}),
								},
								eventMetadata: suggestionMetadata,
							});
							if (result?.error) {
								continue;
							}
						}
						continue;
					}

					if (action.action_id === "agent_edit") {
						const suggestion = parseAgentSuggestionPayload(action.value);
						if (!suggestion) {
							continue;
						}
						const suggestionChannel = payload.channel?.id;
						const suggestionTs = payload.message?.ts ?? payload.container?.message_ts;
						const suggestionBlocks = payload.message?.blocks;
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
							suggestion: {
								...suggestion,
								...(suggestionChannel ? { messageChannel: suggestionChannel } : {}),
								...(suggestionTs ? { messageTs: suggestionTs } : {}),
								...(suggestionBlocks ? { messageBlocks: suggestionBlocks } : {}),
							},
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
