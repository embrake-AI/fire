import { assignee } from "@fire/db";
import { createServerFn } from "@tanstack/solid-start";
import { desc, eq } from "drizzle-orm";
import { db } from "./db";
import { fetchSlackUserGroups, fetchSlackUsers } from "./slack";

export type { SlackUser, SlackUserGroup } from "./slack";

export type Assignee = {
	id: string;
	prompt: string;
	type: "slack-user" | "slack-user-group";
	externalId: string;
};

export const getAssignees = createServerFn({
	method: "GET",
}).handler(async () => {
	const assignees = await db
		.select()
		.from(assignee)
		.orderBy(desc(assignee.createdAt));

	const [slackUsers, slackUserGroups] = await Promise.all([
		fetchSlackUsers(),
		fetchSlackUserGroups(),
	]);

	return assignees.map((a) => {
		if (a.type === "slack-user") {
			const slackUser = slackUsers.find((u) => u.id === a.identifier);
			if (!slackUser) {
				// TODO: Handle this better when someone complains
				throw new Error("Slack user not found");
			}
			return {
				id: a.id,
				type: a.type,
				prompt: a.prompt,
				externalId: a.identifier,
				name: slackUser.name,
				avatar: slackUser.avatar,
			};
		} else if (a.type === "slack-user-group") {
			const slackUserGroup = slackUserGroups.find((g) => g.id === a.identifier);
			if (!slackUserGroup) {
				// TODO: Handle this better when someone complains
				throw new Error("Slack user group not found");
			}
			return {
				id: a.id,
				type: a.type,
				prompt: a.prompt,
				externalId: a.identifier,
				name: slackUserGroup.handle,
			};
		} else {
			throw new Error("Invalid assignee type");
		}
	});
});

export const getSlackUsers = createServerFn({
	method: "GET",
}).handler(async () => {
	const assignees = await db.select().from(assignee);
	const slackUsers = await fetchSlackUsers();
	// Filter out users that are already assignees
	const assignedSlackIds = new Set(
		assignees.filter((a) => a.type === "slack-user").map((a) => a.identifier),
	);
	return slackUsers.filter((u) => !assignedSlackIds.has(u.id));
});

export const getSlackUserGroups = createServerFn({
	method: "GET",
}).handler(async () => {
	const assignees = await db.select().from(assignee);
	const slackUserGroups = await fetchSlackUserGroups();
	// Filter out groups that are already assignees
	const assignedSlackIds = new Set(
		assignees
			.filter((a) => a.type === "slack-user-group")
			.map((a) => a.identifier),
	);
	return slackUserGroups.filter((g) => !assignedSlackIds.has(g.id));
});

export const createAssignee = createServerFn({ method: "POST" })
	.inputValidator(
		(data: { id: string; type: "slack-user" | "slack-user-group" }) => data,
	)
	.handler(async ({ data }) => {
		const [newAssignee] = await db
			.insert(assignee)
			.values({
				type: data.type,
				prompt: "",
				identifier: data.id,
			})
			.returning();

		return {
			id: newAssignee.id,
			type: newAssignee.type,
			prompt: newAssignee.prompt,
			externalId: newAssignee.identifier,
		};
	});

export const deleteAssignee = createServerFn({ method: "POST" })
	.inputValidator((data: { id: string }) => data)
	.handler(async ({ data }) => {
		const result = await db
			.delete(assignee)
			.where(eq(assignee.id, data.id))
			.returning();

		if (result.length === 0) {
			throw new Error("Assignee not found");
		}

		return { success: true };
	});

export const updateAssignee = createServerFn({ method: "POST" })
	.inputValidator((data: { id: string; prompt: string }) => data)
	.handler(async ({ data }) => {
		const [updated] = await db
			.update(assignee)
			.set({ prompt: data.prompt })
			.where(eq(assignee.id, data.id))
			.returning();

		if (!updated) {
			throw new Error("Assignee not found");
		}

		return {
			id: updated.id,
			type: updated.type,
			prompt: updated.prompt,
			externalId: updated.identifier,
		};
	});
