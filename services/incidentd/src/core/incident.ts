import { DurableObject } from 'cloudflare:workers'
import { ASSERT } from '../lib/utils';

export type IS = {
	id: string
	createdAt: Date
	updatedAt: Date
	status: 'open' | 'mitigating' | 'resolved'
	prompt: string
	severity: 'low' | 'medium' | 'high'
	createdBy?: string
	assignee: string,
	source: 'slack' | 'dashboard'
}

async function calculateAssigneeAndSeverity(prompt: string) {
	const assignee = 'U05G1BLH2SU' //await getAssigneeFromPrompt(prompt)
	const severity: IS['severity'] = 'low' //await getSeverityFromPrompt(prompt)
	return { assignee, severity }
}

/**
 * An Incident is the source of truth for an incident. It is agnostic of the communication channel(s).
 * It provides the interface to track and update the incident.
 * It does NOT handle interactions with the incident.
 */
export class Incident extends DurableObject<Env> {
	/**
	 * The state of the incident. It is kept in memory until the incident is resolved.
	 */
	private state: IS | undefined = undefined
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env)
		this.ctx.blockConcurrencyWhile(async () => {
			const values = await this.ctx.storage.get<IS>('incident')
			this.state = values
		})
	}

	private async init({ id, prompt, createdBy, source }: Pick<IS, 'id' | 'prompt' | 'createdBy' | 'source'>) {
		const { assignee, severity } = await calculateAssigneeAndSeverity(prompt)
		const payload = {
			id,
			createdAt: new Date(),
			updatedAt: new Date(),
			status: 'open',
			severity,
			createdBy,
			assignee,
			prompt,
			source
		} as const
		await this.ctx.storage.put<IS>('incident', payload)
		this.state = payload
		return payload
	}

	/**
	 * Entry point to start a new incident. It must be called before any other method.
	 */
	async start({ id, prompt, createdBy, source }: Pick<IS, 'id' | 'prompt' | 'createdBy' | 'source'>) {
		return this.init({
			id,
			prompt,
			createdBy,
			source
		})
	}

	async setPriority(priority: IS['severity']) {
		ASSERT(this.state, 'Incident not initialized')
		this.state.severity = priority
		this.state.updatedAt = new Date()
		await this.ctx.storage.put<IS>('incident', this.state)
	}

	async setAssignee(assignee: IS['assignee']) {
		ASSERT(this.state, 'Incident not initialized')
		this.state.assignee = assignee
		this.state.updatedAt = new Date()
		await this.ctx.storage.put<IS>('incident', this.state)
	}

	async get() {
		return this.state
	}
}
