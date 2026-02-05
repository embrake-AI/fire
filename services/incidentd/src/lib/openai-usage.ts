type OpenAIUsage = {
	prompt_tokens?: number;
	completion_tokens?: number;
	total_tokens?: number;
	prompt_tokens_details?: {
		cached_tokens?: number;
	};
};

type OpenAIUsageResponse = {
	id?: string;
	model?: string;
	usage?: OpenAIUsage;
};

export function logOpenAIUsage(context: string, data: OpenAIUsageResponse) {
	const promptTokens = data.usage?.prompt_tokens ?? 0;
	const cachedPromptTokens = data.usage?.prompt_tokens_details?.cached_tokens ?? 0;
	const completionTokens = data.usage?.completion_tokens ?? 0;
	const totalTokens = data.usage?.total_tokens ?? 0;
	const cacheHitPercent = promptTokens > 0 ? Number(((cachedPromptTokens / promptTokens) * 100).toFixed(1)) : 0;

	console.log("[openai.usage]", {
		context,
		requestId: data.id ?? "unknown",
		model: data.model ?? "unknown",
		promptTokens,
		cachedPromptTokens,
		cacheHitPercent,
		completionTokens,
		totalTokens,
	});
}
