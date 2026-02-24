export type SlackUser = {
	id: string;
	name: string;
	email: string;
	avatar?: string;
};

export type SlackChannel = {
	id: string;
	name: string;
	isPrivate: boolean;
};

export type SlackSelectableChannel = SlackChannel & {
	isMember: boolean;
};

type SlackUserResponse = {
	ok: boolean;
	members?: Array<{
		id: string;
		name: string;
		deleted: boolean;
		is_bot: boolean;
		is_app_user: boolean;
		profile: {
			real_name?: string;
			display_name?: string;
			email?: string;
			image_48?: string;
			image_72?: string;
		};
	}>;
	response_metadata?: {
		next_cursor?: string;
	};
	error?: string;
};

export async function fetchSlackUsers(botToken: string): Promise<SlackUser[]> {
	const users: SlackUser[] = [];
	let cursor: string | undefined;

	do {
		const params = new URLSearchParams({ limit: "200" });
		if (cursor) {
			params.set("cursor", cursor);
		}

		const response = await fetch(`https://slack.com/api/users.list?${params.toString()}`, {
			headers: {
				Authorization: `Bearer ${botToken}`,
				"Content-Type": "application/json",
			},
		});

		const data: SlackUserResponse = await response.json();

		if (!data.ok) {
			throw new Error(`Slack API error: ${data.error}`);
		}

		if (data.members) {
			for (const member of data.members) {
				if (member.deleted || member.is_bot || member.is_app_user) {
					continue;
				}

				users.push({
					id: member.id,
					name: member.profile.real_name || member.profile.display_name || member.name,
					email: member.profile.email || "",
					avatar: member.profile.image_72 || member.profile.image_48,
				});
			}
		}

		cursor = data.response_metadata?.next_cursor;
	} while (cursor);

	return users;
}

type SlackUsersConversationsResponse = {
	ok: boolean;
	channels?: Array<{
		id: string;
		name: string;
		is_channel: boolean;
		is_private: boolean;
	}>;
	response_metadata?: {
		next_cursor?: string;
	};
	error?: string;
};

type SlackConversationsListResponse = {
	ok: boolean;
	channels?: Array<{
		id: string;
		name: string;
		is_channel: boolean;
		is_private: boolean;
		is_member?: boolean;
	}>;
	response_metadata?: {
		next_cursor?: string;
	};
	error?: string;
};

type SlackConversationsJoinResponse = {
	ok: boolean;
	error?: string;
};

/**
 * Fetch Slack channels where the bot is a member using the users.conversations endpoint.
 * @see https://docs.slack.dev/reference/methods/users.conversations/
 */
export async function fetchSlackBotChannels(botToken: string): Promise<SlackChannel[]> {
	const channels: SlackChannel[] = [];
	let cursor: string | undefined;

	do {
		const params = new URLSearchParams({
			types: "public_channel,private_channel",
			exclude_archived: "true",
			limit: "200",
		});
		if (cursor) {
			params.set("cursor", cursor);
		}

		const response = await fetch(`https://slack.com/api/users.conversations?${params.toString()}`, {
			headers: {
				Authorization: `Bearer ${botToken}`,
				"Content-Type": "application/json",
			},
		});

		const data: SlackUsersConversationsResponse = await response.json();

		if (!data.ok) {
			throw new Error(`Slack API error: ${data.error}`);
		}

		if (data.channels) {
			for (const channel of data.channels) {
				channels.push({
					id: channel.id,
					name: channel.name,
					isPrivate: channel.is_private,
				});
			}
		}

		cursor = data.response_metadata?.next_cursor;
	} while (cursor);

	return channels;
}

/**
 * Fetch selectable Slack channels for rotation settings.
 * Uses conversations.list so public channels are returned even when the bot is not a member.
 * @see https://docs.slack.dev/reference/methods/conversations.list/
 */
export async function fetchSlackSelectableChannels(botToken: string): Promise<SlackSelectableChannel[]> {
	const channels: SlackSelectableChannel[] = [];
	let cursor: string | undefined;

	do {
		const params = new URLSearchParams({
			types: "public_channel,private_channel",
			exclude_archived: "true",
			limit: "200",
		});
		if (cursor) {
			params.set("cursor", cursor);
		}

		const response = await fetch(`https://slack.com/api/conversations.list?${params.toString()}`, {
			headers: {
				Authorization: `Bearer ${botToken}`,
				"Content-Type": "application/json",
			},
		});

		const data: SlackConversationsListResponse = await response.json();

		if (!data.ok) {
			throw new Error(`Slack API error: ${data.error}`);
		}

		if (data.channels) {
			for (const channel of data.channels) {
				if (!channel.is_channel) {
					continue;
				}
				// Only show private channels when the bot is already a member.
				// Public channels remain selectable so we can auto-join on save.
				if (channel.is_private && !channel.is_member) {
					continue;
				}
				channels.push({
					id: channel.id,
					name: channel.name,
					isPrivate: channel.is_private,
					isMember: channel.is_member ?? false,
				});
			}
		}

		cursor = data.response_metadata?.next_cursor;
	} while (cursor);

	return channels.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Join a public Slack channel as the bot.
 * @see https://docs.slack.dev/reference/methods/conversations.join/
 */
export async function joinSlackChannel(botToken: string, channelId: string): Promise<void> {
	const response = await fetch("https://slack.com/api/conversations.join", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${botToken}`,
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: new URLSearchParams({
			channel: channelId,
		}),
	});

	const data: SlackConversationsJoinResponse = await response.json();

	if (!data.ok) {
		throw new Error(`Slack API error: ${data.error}`);
	}
}

type SlackEmojiResponse = {
	ok: boolean;
	emoji?: Record<string, string>;
	error?: string;
};

/**
 * Fetch custom emojis from Slack workspace.
 * @see https://docs.slack.dev/reference/methods/emoji.list/
 */
export async function fetchSlackEmojis(botToken: string): Promise<Record<string, string>> {
	const response = await fetch("https://slack.com/api/emoji.list", {
		headers: {
			Authorization: `Bearer ${botToken}`,
			"Content-Type": "application/json",
		},
	});

	const data: SlackEmojiResponse = await response.json();

	if (!data.ok) {
		throw new Error(`Slack API error: ${data.error}`);
	}

	return data.emoji || {};
}

type SlackLookupByEmailResponse = {
	ok: boolean;
	user?: {
		id: string;
		name: string;
		profile?: {
			email?: string;
		};
	};
	error?: string;
};

/**
 * Look up a Slack user by their email address.
 * @see https://docs.slack.dev/reference/methods/users.lookupByEmail/
 */
export async function lookupSlackUserIdByEmail(botToken: string, email: string) {
	const response = await fetch(`https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`, {
		headers: {
			Authorization: `Bearer ${botToken}`,
			"Content-Type": "application/json",
		},
	});

	const data: SlackLookupByEmailResponse = await response.json();

	if (!data.ok || !data.user) {
		return null;
	}

	return data.user.id;
}

type SlackUserInfoResponse = {
	ok: boolean;
	user?: {
		id: string;
		name: string;
		deleted: boolean;
		is_bot: boolean;
		is_app_user: boolean;
		profile: {
			real_name?: string;
			display_name?: string;
			email?: string;
			image_48?: string;
			image_72?: string;
			image_192?: string;
		};
	};
	error?: string;
};

/**
 * Fetch a single Slack user by their ID.
 * @see https://docs.slack.dev/reference/methods/users.info/
 */
export async function fetchSlackUserById(botToken: string, userId: string): Promise<SlackUser | null> {
	const response = await fetch(`https://slack.com/api/users.info?user=${encodeURIComponent(userId)}`, {
		headers: {
			Authorization: `Bearer ${botToken}`,
			"Content-Type": "application/json",
		},
	});

	const data: SlackUserInfoResponse = await response.json();

	if (!data.ok || !data.user) {
		return null;
	}

	const member = data.user;
	if (member.deleted || member.is_bot || member.is_app_user) {
		return null;
	}

	return {
		id: member.id,
		name: member.profile.real_name || member.profile.display_name || member.name,
		email: member.profile.email || "",
		avatar: member.profile.image_192 || member.profile.image_72 || member.profile.image_48,
	};
}

type SlackPostMessageResponse = {
	ok: boolean;
	error?: string;
};

/**
 * Post a message to a Slack channel as the bot.
 * @see https://docs.slack.dev/reference/methods/chat.postMessage/
 */
export async function postSlackMessage(botToken: string, params: { channel: string; text: string; blocks?: unknown[] }): Promise<void> {
	const body: Record<string, unknown> = {
		channel: params.channel,
		text: params.text,
		mrkdwn: true,
	};
	if (params.blocks) {
		body.blocks = params.blocks;
	}

	const response = await fetch("https://slack.com/api/chat.postMessage", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${botToken}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});

	const data: SlackPostMessageResponse = await response.json();

	if (!data.ok) {
		throw new Error(`Slack API error: ${data.error}`);
	}
}
