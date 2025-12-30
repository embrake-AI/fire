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

export function replaceEmojis(text: string): string {
	return text.replace(/:[\w\-+]+:/g, (match) => {
		const emoji = getEmoji(match);
		if (emoji) {
			const cleanShortcode = match.replace(/^:+|:+$/g, "");
			if (customEmojiMap?.has(cleanShortcode)) {
				return `<img src="${emoji}" alt="${match}" class="inline-emoji" />`;
			}
			return emoji;
		}
		return match;
	});
}

export function useEmojis() {
	const [loaded, setLoaded] = createSignal(emojiMap !== null);

	onMount(() => {
		loadEmojis().then(() => setLoaded(true));
	});

	return loaded;
}
