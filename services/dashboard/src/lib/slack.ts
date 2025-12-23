export type SlackUser = {
	id: string;
	name: string;
	email: string;
	avatar?: string;
};

export type SlackUserGroup = {
	id: string;
	name: string;
	handle: string;
	memberCount: number;
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

type SlackUserGroupResponse = {
	ok: boolean;
	usergroups?: Array<{
		id: string;
		name: string;
		handle: string;
		user_count: number;
	}>;
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

export async function fetchSlackUserGroups(botToken: string): Promise<SlackUserGroup[]> {
	const response = await fetch("https://slack.com/api/usergroups.list", {
		headers: {
			Authorization: `Bearer ${botToken}`,
			"Content-Type": "application/json",
		},
	});

	const data: SlackUserGroupResponse = await response.json();

	if (!data.ok) {
		throw new Error(`Slack API error: ${data.error}`);
	}

	return (data.usergroups || []).map((group) => ({
		id: group.id,
		name: group.name,
		handle: group.handle,
		memberCount: group.user_count,
	}));
}
