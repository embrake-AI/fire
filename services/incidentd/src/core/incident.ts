import { DurableObject } from "cloudflare:workers";
import type { IS } from "@fire/common";
import type { Metadata } from "../handler";
import { ASSERT } from "../lib/utils";

async function calculateIncidentInfo(_prompt: string) {
	const assignee = "U05G1BLH2SU"; //await getAssigneeFromPrompt(prompt)
	const severity: IS["severity"] = "low"; //await getSeverityFromPrompt(prompt)
	const title = "random-title"; //await getTitleFromPrompt(prompt)
	const description = "random-description, a bit longer or it doesnt look like a description"; //await getDescriptionFromPrompt(prompt)
	return { assignee, severity, title, description };
}

export type DOState = IS & {
	metadata: Metadata;
};

/**
 * An Incident is the source of truth for an incident. It is agnostic of the communication channel(s).
 * All operations guarantee transactional consistency: https://blog.cloudflare.com/durable-objects-easy-fast-correct-choose-three/
 */
export class Incident extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
	}

	private async init({ id, prompt, createdBy, source, metadata }: Pick<DOState, "id" | "prompt" | "createdBy" | "source" | "metadata">) {
		const { assignee, severity, title, description } = await calculateIncidentInfo(prompt);
		const payload = {
			id,
			createdAt: new Date(),
			status: "open",
			severity,
			createdBy,
			assignee,
			title,
			description,
			prompt,
			source,
			metadata,
		} as const;
		await this.ctx.storage.put<DOState>("incident", payload);
		return payload;
	}

	/**
	 * Entry point to start a new incident. It must be called before any other method.
	 */
	async start({ id, prompt, createdBy, source, metadata }: Pick<DOState, "id" | "prompt" | "createdBy" | "source" | "metadata">) {
		return this.init({
			id,
			prompt,
			createdBy,
			source,
			metadata,
		});
	}

	async setSeverity(severity: DOState["severity"]) {
		const state = await this.ctx.storage.get<DOState>("incident");
		ASSERT(state, "Incident not initialized");
		state.severity = severity;
		await this.ctx.storage.put<DOState>("incident", state);
		return state;
	}

	async setAssignee(assignee: DOState["assignee"]) {
		const state = await this.ctx.storage.get<DOState>("incident");
		ASSERT(state, "Incident not initialized");
		state.assignee = assignee;
		await this.ctx.storage.put<DOState>("incident", state);
		return state;
	}

	async get() {
		const state = await this.ctx.storage.get<DOState>("incident");
		// and more
		return state;
	}

	async addMetadata(metadata: Record<string, string>) {
		const state = await this.ctx.storage.get<DOState>("incident");
		ASSERT(state, "Incident not initialized");
		state.metadata = { ...state.metadata, ...metadata };
		await this.ctx.storage.put<DOState>("incident", state);
		return state;
	}
}
