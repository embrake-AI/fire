import { createSignal, onMount } from "solid-js";

export interface EmojiData {
	shortcode: string;
	emoji: string;
}

export interface CustomEmojiData {
	shortcode: string;
	url: string;
}

let emojiMap: Map<string, string> | null = null;
let customEmojiMap: Map<string, string> | null = null;
let loadingPromise: Promise<void> | null = null;
const EMOJI_SHORTCODE_REGEX = /:[\w\-+]+:/g;
const LINK_TOKEN_REGEX = /<https?:\/\/[^>\s]+(?:\|[^>]+)?>|https?:\/\/[^\s<]+/g;

function escapeHtml(text: string): string {
	return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function sanitizeHttpUrl(url: string): string | null {
	try {
		const parsedUrl = new URL(url);
		if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
			return null;
		}
		return parsedUrl.toString();
	} catch {
		return null;
	}
}

export async function loadEmojis(): Promise<void> {
	if (loadingPromise) {
		return loadingPromise;
	}

	if (emojiMap) {
		return;
	}

	loadingPromise = (async () => {
		try {
			const response = await fetch("https://cdn.jsdelivr.net/npm/emojibase-data@17.0.0/en/shortcodes/iamcal.json");
			const data = await response.json();

			emojiMap = new Map();
			for (const [hexCode, shortcodes] of Object.entries(data) as [string, string | string[]][]) {
				const emoji = hexCode
					.split("-")
					.map((hex) => String.fromCodePoint(parseInt(hex, 16)))
					.join("");
				const codes = Array.isArray(shortcodes) ? shortcodes : [shortcodes];
				for (const code of codes) {
					emojiMap.set(code, emoji);
				}
			}
		} catch (error) {
			console.error("Failed to load emojis:", error);
			emojiMap = new Map();
		}
	})();

	return loadingPromise;
}

export function setCustomEmojis(customEmojis: Record<string, string>): void {
	customEmojiMap = new Map();
	for (const [shortcode, url] of Object.entries(customEmojis)) {
		customEmojiMap.set(shortcode, url);
	}
}

export function getEmoji(shortcode: string): string | null {
	const cleanShortcode = shortcode.replace(/^:+|:+$/g, "");

	if (customEmojiMap?.has(cleanShortcode)) {
		return customEmojiMap.get(cleanShortcode) || null;
	}

	return emojiMap?.get(cleanShortcode) || null;
}

export function searchEmojis(query: string, limit = 20): Array<{ shortcode: string; emoji: string; isCustom: boolean }> {
	const results: Array<{ shortcode: string; emoji: string; isCustom: boolean }> = [];
	const lowerQuery = query.toLowerCase();

	if (customEmojiMap) {
		for (const [shortcode, url] of customEmojiMap.entries()) {
			if (shortcode.toLowerCase().includes(lowerQuery)) {
				results.push({ shortcode, emoji: url, isCustom: true });
				if (results.length >= limit) return results;
			}
		}
	}

	if (emojiMap) {
		for (const [shortcode, emoji] of emojiMap.entries()) {
			if (shortcode.toLowerCase().includes(lowerQuery)) {
				results.push({ shortcode, emoji, isCustom: false });
				if (results.length >= limit) return results;
			}
		}
	}

	return results;
}

function replaceEmojiShortcodes(text: string): string {
	let result = "";
	let lastIndex = 0;

	for (const match of text.matchAll(EMOJI_SHORTCODE_REGEX)) {
		const shortcode = match[0];
		const start = match.index ?? 0;
		result += escapeHtml(text.slice(lastIndex, start));

		const emoji = getEmoji(shortcode);
		if (!emoji) {
			result += escapeHtml(shortcode);
			lastIndex = start + shortcode.length;
			continue;
		}

		const cleanShortcode = shortcode.replace(/^:+|:+$/g, "");
		if (customEmojiMap?.has(cleanShortcode)) {
			const sanitizedUrl = sanitizeHttpUrl(emoji);
			if (!sanitizedUrl) {
				result += escapeHtml(shortcode);
			} else {
				result += `<img src="${escapeHtml(sanitizedUrl)}" alt="${escapeHtml(shortcode)}" class="inline-emoji" />`;
			}
		} else {
			result += escapeHtml(emoji);
		}

		lastIndex = start + shortcode.length;
	}

	result += escapeHtml(text.slice(lastIndex));
	return result;
}

function trimTrailingUrlPunctuation(url: string): { url: string; trailing: string } {
	let end = url.length;
	while (end > 0) {
		const char = url[end - 1];
		const shouldTrim = char === "." || char === "," || char === ";" || char === "!" || char === "?";
		if (!shouldTrim) break;
		end -= 1;
	}

	const candidateUrl = url.slice(0, end);
	const trailing = url.slice(end);
	return { url: candidateUrl, trailing };
}

function formatLinkLabel(url: string, explicitLabel?: string): string {
	if (explicitLabel && explicitLabel.trim().length > 0) {
		return explicitLabel.trim();
	}

	try {
		const parsedUrl = new URL(url);
		const display = `${parsedUrl.host}${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
		if (display.length > 90) {
			return `${display.slice(0, 87)}...`;
		}
		return display;
	} catch {
		return url;
	}
}

function renderLink(url: string, explicitLabel?: string): string {
	const sanitizedUrl = sanitizeHttpUrl(url);
	if (!sanitizedUrl) {
		return replaceEmojiShortcodes(explicitLabel ? `<${url}|${explicitLabel}>` : url);
	}

	const label = formatLinkLabel(sanitizedUrl, explicitLabel);
	return `<a href="${escapeHtml(sanitizedUrl)}" target="_blank" rel="noopener noreferrer" class="text-primary hover:text-primary/80 underline underline-offset-2 break-all">${replaceEmojiShortcodes(label)}</a>`;
}

export function replaceEmojis(text: string): string {
	let result = "";
	let lastIndex = 0;

	for (const match of text.matchAll(LINK_TOKEN_REGEX)) {
		const token = match[0];
		const start = match.index ?? 0;
		result += replaceEmojiShortcodes(text.slice(lastIndex, start));

		if (token.startsWith("<") && token.endsWith(">")) {
			const inner = token.slice(1, -1);
			const pipeIndex = inner.indexOf("|");
			if (pipeIndex === -1) {
				result += renderLink(inner);
			} else {
				const url = inner.slice(0, pipeIndex);
				const label = inner.slice(pipeIndex + 1);
				result += renderLink(url, label);
			}
		} else {
			const { url, trailing } = trimTrailingUrlPunctuation(token);
			result += renderLink(url);
			result += replaceEmojiShortcodes(trailing);
		}

		lastIndex = start + token.length;
	}

	result += replaceEmojiShortcodes(text.slice(lastIndex));
	return result;
}

export function useEmojis() {
	const [loaded, setLoaded] = createSignal(emojiMap !== null);

	onMount(() => {
		loadEmojis().then(() => setLoaded(true));
	});

	return loaded;
}
