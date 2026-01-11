import { integration, rotation, user } from "@fire/db/schema";
import { eq } from "drizzle-orm";
import { db } from "../../../lib/db";
import type { TransitionReason } from "./calc";

/**
 * Send a Slack notification when the rotation assignee changes.
 */
export async function notifyOnSlack(
	rotationId: string,
	previousAssigneeId: string | null,
	newAssigneeId: string | null,
	reason: TransitionReason | "manual_change",
): Promise<void> {
	"use step";

	// Skip if no change
	if (previousAssigneeId === newAssigneeId) return;

	// Get rotation details
	const [rot] = await db.select().from(rotation).where(eq(rotation.id, rotationId));
	if (!rot) return;

	// Get Slack integration for this client
	const [slackIntegration] = await db
		.select()
		.from(integration)
		.where(eq(integration.clientId, rot.clientId))
		.limit(1);

	if (!slackIntegration?.data?.botToken) {
		console.log(`No Slack integration found for client ${rot.clientId}, skipping notification`);
		return;
	}

	// TODO: Use botToken when notification channel is configured
	// const botToken = slackIntegration.data.botToken;

	// Get user details for the new assignee
	let newAssigneeSlackId: string | null = null;
	let newAssigneeName: string | null = null;

	if (newAssigneeId) {
		const [newUser] = await db.select().from(user).where(eq(user.id, newAssigneeId));
		if (newUser) {
			newAssigneeSlackId = newUser.slackId;
			newAssigneeName = newUser.name;
		}
	}

	// Build the notification message
	const reasonText = getReasonText(reason);
	const assigneeText = newAssigneeSlackId ? `<@${newAssigneeSlackId}>` : newAssigneeName || "Unassigned";

	const message = `*${rot.name}* rotation update: ${assigneeText} is now on-call (${reasonText})`;

	// TODO: Make the notification channel configurable per rotation/team
	// For now, we'll log the notification. In the future, this should post to a configured channel.
	console.log(`[Rotation Notification] ${message}`);

	// TODO: Uncomment when notification channel is configured:
	// await postSlackMessage(botToken, channelId, message);
}

function getReasonText(reason: TransitionReason | "manual_change"): string {
	switch (reason) {
		case "shift_change":
			return "scheduled shift change";
		case "override_start":
			return "override started";
		case "override_end":
			return "override ended";
		case "manual_change":
			return "manual update";
		default:
			return "change";
	}
}

// TODO: Use this when notification channel is configured
// async function postSlackMessage(botToken: string, channelId: string, text: string): Promise<void> {
// 	const response = await fetch("https://slack.com/api/chat.postMessage", {
// 		method: "POST",
// 		headers: {
// 			Authorization: `Bearer ${botToken}`,
// 			"Content-Type": "application/json",
// 		},
// 		body: JSON.stringify({
// 			channel: channelId,
// 			text,
// 			unfurl_links: false,
// 			unfurl_media: false,
// 		}),
// 	});

// 	const data = await response.json();
// 	if (!data.ok) {
// 		console.error(`Failed to post Slack message: ${data.error}`);
// 	}
// }
