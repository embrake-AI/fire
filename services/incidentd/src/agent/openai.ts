import type OpenAI from "openai";

export function extractMessageText(content: unknown): string {
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return "";
	}
	return content
		.map((part) => {
			if (!part || typeof part !== "object") {
				return "";
			}
			const typed = part as { type?: string; text?: string };
			if (typed.type === "text" && typeof typed.text === "string") {
				return typed.text;
			}
			return "";
		})
		.filter(Boolean)
		.join("\n");
}

export function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
	if (!value) {
		return {};
	}
	try {
		const parsed = JSON.parse(value) as unknown;
		return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

export function isResponsesFunctionToolCall(item: OpenAI.Responses.ResponseOutputItem): item is OpenAI.Responses.ResponseFunctionToolCall {
	return item.type === "function_call";
}
