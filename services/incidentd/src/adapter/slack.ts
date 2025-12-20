import { Context, Hono, Next } from 'hono'
import type { KnownBlock, SlackEvent } from '@slack/types'
import type { IS } from '../core/incident'
import { ASSERT_NEVER } from '../lib/utils'
import { startIncident, updateAssignee, updatePriority } from '../core/interactions'

type SlackEventPayload =
	| { type: 'url_verification'; challenge: string }
	| { type: 'event_callback'; event: SlackEvent }

type SlackBlockActionPayload = {
	type: 'block_actions'
	user: {
		id: string
		username?: string
	}
	channel?: {
		id: string
		name?: string
	}
	message?: {
		ts: string
		blocks?: any[]
	}
	container?: {
		type: 'message' | 'view'
		message_ts?: string
		block_id?: string
	}
	actions: Array<
		| {
			type: 'static_select'
			action_id: 'set_priority'
			block_id: string
			selected_option: {
				text: { type: 'plain_text'; text: string }
				value: IS['severity']
			}
		}
		| {
			type: 'users_select'
			action_id: 'set_assignee'
			block_id: string
			selected_user: string
		}
	>
}

const slackRoutes = new Hono<{ Bindings: Env }>()

slackRoutes.post('/events', verifySlackRequestMiddleware, async (c) => {
	const body = await c.req.json<SlackEventPayload>()
	if (body.type === 'event_callback') {
		const event = body.event

		if (event.type === 'app_mention') {
			if (event.subtype === 'bot_message') {
				return c.text('OK')
			}
			const channel = event.channel
			const text = event.text as string // includes the mention like "<@U123> prompt"
			const user = event.user
			const thread = event.thread_ts ?? event.ts

			const prompt = text.replace(/<@[^>]+>\s*/g, '').trim()

			c.executionCtx.waitUntil((async () => {
				const { id, severity, assignee } = await startIncident({ c, identifier: thread, prompt, createdBy: user, source: 'slack' })
				await replyToSlack({
					botToken: c.env.SLACK_BOT_TOKEN,
					channel,
					thread,
					blocks: incidentBlocks(c.env.FRONTEND_URL, id, severity, assignee),
				})
			})())
		} else if (event.type === 'message') {
			/**
			 * Check if relevant
			 * Update
			 */
		}

		return c.text('OK')
	} else if (body.type === 'url_verification') {
		return c.text(body.challenge)
	}

	return c.text('OK')
})

slackRoutes.post('/interaction', async (c) => {
	const body = await c.req.parseBody<{ payload: string }>()
	const payload = JSON.parse(body.payload) as SlackBlockActionPayload
	for (const action of payload.actions) {
		const incidentId = action.block_id.split(':')[1]
		if (!incidentId) {
			throw new Error('Incident ID not found')
		}
		if (action.type === 'static_select' && action.action_id === 'set_priority') {
			await updatePriority({ c, id: incidentId, priority: action.selected_option.value })
		} else if (action.type === 'users_select' && action.action_id === 'set_assignee') {
			await updateAssignee({ c, id: incidentId, assignee: action.selected_user })
		} else {
			ASSERT_NEVER(action)
		}
	}
	return c.text('OK')
})

async function replyToSlack({
	botToken,
	channel,
	thread,
	message,
	blocks,
}: {
	botToken: string
	channel: string
	message?: string
	thread?: string
	blocks?: KnownBlock[]
}) {
	if (!message && !blocks) {
		throw new Error('Either message or blocks must be provided')
	}
	const response = await fetch(`https://slack.com/api/chat.postMessage`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${botToken}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			channel,
			text: message,
			thread_ts: thread,
			blocks,
		}),
	})
	return response.json()
}

async function verifySlackRequestMiddleware(c: Context, next: Next) {
	const rawBody = await c.req.raw.clone().text()
	if (!(await verifySlackRequest(c, rawBody))) {
		return c.json({ error: 'Unauthorized' }, 401)
	}
	await next()
}

async function verifySlackRequest(c: any, rawBody: string) {
	const ts = c.req.header('X-Slack-Request-Timestamp')
	const sig = c.req.header('X-Slack-Signature')
	if (!ts || !sig) return false

	const now = Math.floor(Date.now() / 1000)
	const tsNum = Number(ts)
	if (!Number.isFinite(tsNum) || Math.abs(now - tsNum) > 60 * 5) return false

	const baseString = `v0:${ts}:${rawBody}`

	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(c.env.SLACK_SIGNING_SECRET),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	)

	const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(baseString))
	const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')
	const expected = `v0=${hex}`

	return expected === sig
}

function incidentBlocks(frontendUrl: string, incidentId: string, severity: IS['severity'], assigneeUserId?: string): KnownBlock[] {
	return [
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: `🚨 <${frontendUrl}/incidents/${incidentId}|Incident created>`,
			},
		},
		{
			type: 'section',
			fields: [
				{ type: 'mrkdwn', text: `*Priority:*\n${severity}` },
				{
					type: 'mrkdwn',
					text: `*Assignee:*\n${assigneeUserId ? `<@${assigneeUserId}>` : '_Unassigned_'}`,
				},
			],
		},
		{ type: 'divider' },
		{
			type: 'actions',
			block_id: `incident:${incidentId}`, // <— key: embeds incidentId
			elements: [
				{
					type: 'static_select',
					action_id: 'set_priority',
					placeholder: { type: 'plain_text', text: 'Change priority' },
					initial_option: { text: { type: 'plain_text', text: severity }, value: severity },
					options: ['low', 'medium', 'high'].map((p) => ({
						text: { type: 'plain_text', text: p },
						value: p,
					})),
				},
				{
					type: 'users_select',
					action_id: 'set_assignee',
					placeholder: { type: 'plain_text', text: 'Assign to…' },
					...(assigneeUserId ? { initial_user: assigneeUserId } : {}),
				},
			],
		},
	] as const
}

export { slackRoutes }
