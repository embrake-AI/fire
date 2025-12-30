import { createMemo, For, Show } from "solid-js";
import { searchEmojis } from "~/lib/emoji/emoji";

interface EmojiPickerProps {
	query: string;
	onSelect: (shortcode: string, emoji: string) => void;
	position: { top: number; left: number };
}

export function EmojiPicker(props: EmojiPickerProps) {
	const results = createMemo(() => {
		if (props.query.length < 2) return [];
		return searchEmojis(props.query, 10);
	});

	const hasResults = () => results().length > 0;

	return (
		<Show when={props.query.length >= 2}>
			<div
				class="absolute z-50 bg-popover border border-border rounded-md shadow-md max-h-75 overflow-y-auto"
				style={{
					top: `${props.position.top}px`,
					left: `${props.position.left}px`,
					width: "280px",
				}}
			>
				<Show when={hasResults()} fallback={<div class="px-4 py-2 text-sm text-muted-foreground">No emojis found</div>}>
					<div class="py-1">
						<For each={results()}>
							{(result) => (
								<button
									type="button"
									class="w-full px-4 py-2 text-left hover:bg-accent hover:text-accent-foreground flex items-center gap-3 cursor-pointer"
									onClick={() => props.onSelect(result.shortcode, result.emoji)}
								>
									<Show when={result.isCustom} fallback={<span class="text-2xl leading-none">{result.emoji}</span>}>
										<img src={result.emoji} alt={result.shortcode} class="w-6 h-6 object-contain" />
									</Show>
									<span class="text-sm">:{result.shortcode}:</span>
								</button>
							)}
						</For>
					</div>
				</Show>
			</div>
		</Show>
	);
}
