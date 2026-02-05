import type { EntryPoint, IS } from "@fire/common";
import type { SlackIntegrationData } from "@fire/db/schema";
import type { KnownBlock, SlackEvent } from "@slack/types";
import { sql } from "drizzle-orm";
import type { Context } from "hono";
import type { AgentSuggestionPayload } from "../../../agent/slack";
import type { BasicContext } from "../../../handler/index";
import { getDB } from "../../../lib/db";

// ============================================================================
// Types
// ============================================================================

export type SlackEventPayload =
	| { type: "url_verification"; challenge: string }
	| {
			type: "event_callback";
			team_id?: string;
			enterprise_id?: string;
			is_enterprise_install?: boolean;
			event: SlackEvent;
	  };

export type SlackBlockActionPayload = {
	type: "block_actions";
	trigger_id: string;
	team: {
		id: string;
		domain?: string;
		enterprise_id?: string;
	};
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
		| {
				type: "static_select";
				action_id: "set_status";
				block_id: string;
				selected_option: {
					text: { type: "plain_text"; text: string };
					value: Exclude<IS["status"], "open">;
				};
		  }
		| {
				type: "button";
				action_id: "agent_apply" | "agent_edit";
				block_id: string;
				value: string;
		  }
	>;
};

export type SlackViewSubmissionPayload = {
	type: "view_submission";
	team: {
		id: string;
		domain?: string;
		enterprise_id?: string;
	};
	user: {
		id: string;
		username?: string;
	};
	view: {
		id: string;
		callback_id: string;
		private_metadata: string;
		state: {
			values: Record<
				string,
				Record<
					string,
					{
						type: string;
						value?: string | null;
						selected_option?: { value: string };
					}
				>
			>;
		};
	};
};

export type SlackInteractionPayload = SlackBlockActionPayload | SlackViewSubmissionPayload;

// ============================================================================
// Handlers
// ============================================================================

type StatusUpdateAction = SlackBlockActionPayload["actions"][number] & {
	type: "static_select";
	block_id: string;
};
export async function handleStatusUpdate<E extends BasicContext>(
	c: Context<E>,
	action: StatusUpdateAction,
	{ incidentId, teamId, enterpriseId, triggerId }: { incidentId: string; teamId: string; enterpriseId: string | null; triggerId: string },
) {
	const newStatus = action.selected_option.value as Exclude<IS["status"], "open">;

	const slackIntegration = await getSlackIntegration({
		hyperdrive: c.env.db,
		teamId,
		enterpriseId,
		isEnterpriseInstall: !!enterpriseId,
		withEntryPoints: false,
	});

	if (!slackIntegration) {
		console.error(`No Slack integration found for team ${teamId}`);
		return c.text("OK");
	}

	const { botToken } = slackIntegration.data;

	await openStatusUpdateModal({
		botToken,
		triggerId,
		incidentId,
		newStatus,
	});
}

export async function openAgentSuggestionModal({ botToken, triggerId, suggestion }: { botToken: string; triggerId: string; suggestion: AgentSuggestionPayload }) {
	const actionLabel =
		suggestion.action === "update_status"
			? `Update status → ${suggestion.status}`
			: suggestion.action === "update_severity"
				? `Update severity → ${suggestion.severity}`
				: "Status page update";

	const blocks: KnownBlock[] = [
		{
			type: "section",
			text: {
				type: "mrkdwn",
				text: `*${actionLabel}*`,
			},
		},
		{
			type: "input",
			block_id: "agent_message_block",
			label: {
				type: "plain_text",
				text: "Message",
			},
			element: {
				type: "plain_text_input",
				action_id: "agent_message_input",
				multiline: true,
				initial_value: "message" in suggestion ? suggestion.message : "",
			},
		},
	];

	if (suggestion.action === "add_status_page_update") {
		blocks.push({
			type: "input",
			block_id: "agent_status_block",
			optional: true,
			label: { type: "plain_text", text: "Status" },
			element: {
				type: "static_select",
				action_id: "agent_status_select",
				options: [
					{ text: { type: "plain_text", text: "Investigating" }, value: "investigating" },
					{ text: { type: "plain_text", text: "Mitigating" }, value: "mitigating" },
					{ text: { type: "plain_text", text: "Resolved" }, value: "resolved" },
				],
				...(suggestion.affectionStatus
					? {
							initial_option: {
								text: {
									type: "plain_text",
									text: suggestion.affectionStatus.charAt(0).toUpperCase() + suggestion.affectionStatus.slice(1),
								},
								value: suggestion.affectionStatus,
							},
						}
					: {}),
			},
		});
	}

	const modalView = {
		type: "modal",
		callback_id: "agent_suggestion_edit",
		private_metadata: JSON.stringify(suggestion),
		title: {
			type: "plain_text",
			text: "Edit suggestion",
		},
		submit: {
			type: "plain_text",
			text: "Apply",
		},
		close: {
			type: "plain_text",
			text: "Cancel",
		},
		blocks,
	};

	const response = await fetch("https://slack.com/api/views.open", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${botToken}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			trigger_id: triggerId,
			view: modalView,
		}),
	});
	const payload = await response.json<{ ok?: boolean; error?: string }>().catch(() => ({ ok: false, error: "invalid_response" }));
	if (!response.ok || payload.ok === false) {
		console.error("Slack views.open failed for agent suggestion modal", {
			status: response.status,
			error: payload.error,
		});
	}
}
async function openStatusUpdateModal({
	botToken,
	triggerId,
	incidentId,
	newStatus,
}: {
	botToken: string;
	triggerId: string;
	incidentId: string;
	newStatus: Exclude<IS["status"], "open">;
}) {
	const statusLabel = newStatus === "mitigating" ? "Mitigating" : "Resolved";
	const modalView = {
		type: "modal",
		callback_id: "status_update_modal",
		private_metadata: JSON.stringify({ incidentId, newStatus }),
		title: {
			type: "plain_text",
			text: `Mark as ${statusLabel}`,
		},
		submit: {
			type: "plain_text",
			text: "Confirm",
		},
		close: {
			type: "plain_text",
			text: "Cancel",
		},
		blocks: [
			{
				type: "section",
				text: {
					type: "mrkdwn",
					text: `You are about to mark this incident as *${statusLabel}*.`,
				},
			},
			{
				type: "input",
				block_id: "status_message_block",
				label: {
					type: "plain_text",
					text: newStatus === "resolved" ? "Resolution message" : "Status update message",
				},
				element: {
					type: "plain_text_input",
					action_id: "status_message_input",
					multiline: true,
					placeholder: {
						type: "plain_text",
						text: newStatus === "resolved" ? "Describe how the incident was resolved..." : "Describe the mitigation steps taken...",
					},
				},
			},
		],
	};

	await fetch("https://slack.com/api/views.open", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${botToken}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			trigger_id: triggerId,
			view: modalView,
		}),
	});
}

// ============================================================================
// Utilities
// ============================================================================

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
export async function getSlackIntegration(opts: {
	hyperdrive: Hyperdrive;
	teamId: string;
	enterpriseId?: string | null;
	isEnterpriseInstall?: boolean;
	withEntryPoints?: boolean;
}): Promise<{ clientId: string; data: SlackIntegrationData; entryPoints: EntryPoint[]; services: { id: string; name: string; prompt: string | null }[] } | null> {
	const { hyperdrive, teamId, enterpriseId, isEnterpriseInstall = false } = opts;
	const db = getDB(hyperdrive);

	const result = await db.query.client.findFirst({
		columns: {
			id: true,
		},
		where: {
			RAW: (table) => sql`
				EXISTS (
					SELECT 1 FROM integration WHERE client_id = ${table.id}
					AND platform = 'slack'
					AND data->>'teamId' = ${teamId}
					AND (
						${!isEnterpriseInstall}
						OR data->>'enterpriseId' = ${enterpriseId}
					)
				)
				`,
		},
		with: {
			integrations: {
				columns: {
					platform: true,
					data: true,
				},
				where: {
					platform: {
						eq: "slack",
					},
				},
			},
			entryPoints: opts.withEntryPoints
				? {
						columns: {
							id: true,
							prompt: true,
							type: true,
							isFallback: true,
							rotationId: true,
						},
						with: {
							rotationWithAssignee: {
								with: {
									assignee: {
										columns: {
											id: true,
											slackId: true,
										},
									},
								},
							},
							assignee: {
								columns: {
									id: true,
									slackId: true,
								},
							},
						},
					}
				: {},
			services: {
				columns: {
					id: true,
					name: true,
					prompt: true,
				},
			},
		},
	});

	if (!result || !result.integrations[0]?.data) {
		return null;
	}

	return {
		clientId: result.id,
		data: result.integrations[0]?.data as SlackIntegrationData,
		services: result.services?.map((service) => ({ id: service.id, name: service.name, prompt: service.prompt ?? null })) ?? [],
		entryPoints:
			result.entryPoints
				.map((ep) => {
					let assignee: { id: string; slackId: string } | undefined;

					if (ep.type === "rotation" && "rotationWithAssignee" in ep) {
						if (ep.rotationWithAssignee?.assignee?.slackId) {
							const slackId = ep.rotationWithAssignee.assignee.slackId;
							assignee = {
								slackId,
								id: ep.rotationWithAssignee.assignee.id,
							};
						}
					} else if (ep.type === "user" && "assignee" in ep) {
						if (ep.assignee?.slackId) {
							assignee = {
								slackId: ep.assignee.slackId,
								id: ep.assignee.id,
							};
						}
					} else {
						return null;
					}

					if (!assignee) {
						return null;
					}

					return {
						id: ep.id,
						assignee,
						prompt: ep.prompt,
						isFallback: ep.isFallback,
						rotationId: ep.rotationId ?? undefined,
						teamId: ep.rotationWithAssignee?.teamId ?? undefined,
					};
				})
				.filter((ep) => !!ep) ?? [],
	};
}

/**
 * Fetches the incident ID from a Slack message's metadata.
 * This is used to identify incidents created from the dashboard that were posted to Slack.
 *
 * Should only be called after verifying the message is from a bot (via event.message.bot_id).
 *
 * Returns null if:
 * - The message doesn't have incident metadata
 * - The fetch fails
 */
export async function getIncidentIdFromMessageMetadata({ botToken, channel, messageTs }: { botToken: string; channel: string; messageTs: string }): Promise<string | null> {
	try {
		const response = await fetch(`https://slack.com/api/conversations.history?channel=${channel}&latest=${messageTs}&inclusive=true&limit=1&include_all_metadata=true`, {
			headers: {
				Authorization: `Bearer ${botToken}`,
			},
		});
		const data = await response.json<{
			ok: boolean;
			messages?: Array<{
				ts: string;
				metadata?: {
					event_type: string;
					event_payload: { id?: string };
				};
			}>;
		}>();
		if (!data.ok || !data.messages?.length) {
			return null;
		}
		const message = data.messages[0];
		if (message.metadata?.event_type === "incident" && message.metadata.event_payload?.id) {
			return message.metadata.event_payload.id;
		}
		return null;
	} catch (error) {
		console.error("Failed to fetch message metadata from Slack", error);
		return null;
	}
}

export async function getIncidentIdFromIdentifier({ incidents, identifier }: { incidents: Env["incidents"]; identifier: string }): Promise<string | null> {
	try {
		const result = await incidents
			.prepare("SELECT id FROM incident WHERE EXISTS (SELECT 1 FROM json_each(identifier) WHERE value = ?) LIMIT 1")
			.bind(identifier)
			.all<{ id: string }>();
		return result.results[0]?.id ?? null;
	} catch (error) {
		console.error("Failed to fetch incident by identifier", error);
		return null;
	}
}
