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
