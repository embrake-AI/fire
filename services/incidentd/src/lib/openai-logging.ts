import OpenAI from "openai";

export type OpenAILogContext = {
	operation: string;
	incidentId?: string;
	agentName?: string;
};

type SerializableError = {
	name: string;
	message: string;
	stack?: string;
};

function safeStringify(value: unknown): string {
	const seen = new WeakSet<object>();
	return JSON.stringify(value, (_, innerValue: unknown) => {
		if (typeof innerValue === "bigint") {
			return innerValue.toString();
		}
		if (innerValue && typeof innerValue === "object") {
			if (seen.has(innerValue)) {
				return "[Circular]";
			}
			seen.add(innerValue);
		}
		return innerValue;
	});
}

function serializeError(error: unknown): SerializableError | unknown {
	if (error instanceof Error) {
		return {
			name: error.name,
			message: error.message,
			...(error.stack ? { stack: error.stack } : {}),
		};
	}
	return error;
}

function buildBaseLog(context: OpenAILogContext, logId: string) {
	return {
		log_id: logId,
		operation: context.operation,
		...(context.incidentId ? { incident_id: context.incidentId } : {}),
		...(context.agentName ? { agent_name: context.agentName } : {}),
	};
}

function createLogId() {
	return crypto.randomUUID();
}

export async function callOpenAIWithLogging(params: {
	openaiApiKey: string;
	request: OpenAI.Responses.ResponseCreateParamsNonStreaming;
	context: OpenAILogContext;
}): Promise<OpenAI.Responses.Response> {
	const startedAt = Date.now();
	const logId = createLogId();
	const baseLog = buildBaseLog(params.context, logId);
	const client = new OpenAI({ apiKey: params.openaiApiKey });

	console.log(
		safeStringify({
			event: "openai.request",
			...baseLog,
			request: params.request,
		}),
	);

	try {
		const response = await client.responses.create(params.request);
		console.log(
			safeStringify({
				event: "openai.response",
				...baseLog,
				openai_response_id: response.id,
				duration_ms: Date.now() - startedAt,
				response,
			}),
		);
		return response;
	} catch (error) {
		console.error(
			safeStringify({
				event: "openai.error",
				...baseLog,
				duration_ms: Date.now() - startedAt,
				error: serializeError(error),
			}),
		);
		throw error;
	}
}
