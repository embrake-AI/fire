type OpenAIUsage = {
	prompt_tokens?: number;
	completion_tokens?: number;
	total_tokens?: number;
	input_tokens?: number;
	output_tokens?: number;
	prompt_tokens_details?: {
		cached_tokens?: number;
	};
	input_tokens_details?: {
		cached_tokens?: number;
	};
};

type OpenAIUsageResponse = {
	id?: string;
	model?: string;
	usage?: OpenAIUsage;
};

export function logOpenAIUsage(context: string, data: OpenAIUsageResponse) {
	const promptTokens = data.usage?.prompt_tokens ?? data.usage?.input_tokens ?? 0;
	const cachedPromptTokens = data.usage?.prompt_tokens_details?.cached_tokens ?? data.usage?.input_tokens_details?.cached_tokens ?? 0;
	const cacheHitPercent = promptTokens > 0 ? Number(((cachedPromptTokens / promptTokens) * 100).toFixed(1)) : 0;

	console.log("[openai.usage]", {
		context,
		promptTokens,
		cachedPromptTokens,
		cacheHitPercent,
	});
}
