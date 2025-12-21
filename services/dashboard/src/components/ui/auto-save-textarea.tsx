import { Check, LoaderCircle } from "lucide-solid";
import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { cn } from "~/lib/utils";

export interface AutoSaveTextareaProps {
	/** Initial value */
	value: string;
	/** Async function called to save the value */
	onSave: (value: string) => Promise<void>;
	/** Called when the textarea loses focus */
	onBlur?: () => void;
	/** Placeholder text */
	placeholder?: string;
	/** Label text shown above the textarea */
	label?: string;
	/** Number of rows */
	rows?: number;
	/** Auto-focus the textarea on mount */
	autoFocus?: boolean;
	/** Debounce delay in milliseconds (default: 500) */
	debounceMs?: number;
	/** Additional class names for the textarea */
	class?: string;
	/** ID for the textarea (useful for labels) */
	id?: string;
}

export function AutoSaveTextarea(props: AutoSaveTextareaProps) {
	const [localValue, setLocalValue] = createSignal(props.value);
	const [isSaved, setIsSaved] = createSignal(true);
	let debounceTimer: ReturnType<typeof setTimeout> | undefined;
	let textareaRef: HTMLTextAreaElement | undefined;

	createEffect(() => {
		if (props.autoFocus) {
			requestAnimationFrame(() => {
				textareaRef?.focus();
			});
		}
	});

	onCleanup(() => {
		clearTimeout(debounceTimer);
	});

	const save = async () => {
		if (localValue() !== props.value) {
			await props.onSave(localValue());
			setIsSaved(true);
		}
	};

	const handleInput = (value: string) => {
		setLocalValue(value);
		setIsSaved(false);
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(save, props.debounceMs ?? 500);
	};

	const handleBlur = async () => {
		clearTimeout(debounceTimer);
		await save();
		props.onBlur?.();
	};

	return (
		<div class="space-y-1.5">
			<Show when={props.label}>
				<label for={props.id} class="block text-xs font-medium text-muted-foreground">
					{props.label}
				</label>
			</Show>
			<div class="relative">
				<textarea
					ref={textareaRef}
					id={props.id}
					placeholder={props.placeholder}
					value={localValue()}
					onInput={(e) => handleInput(e.currentTarget.value)}
					onBlur={handleBlur}
					rows={props.rows ?? 3}
					class={cn(
						"w-full px-3 py-2 pr-8 rounded-md border border-input bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 resize-none",
						props.class,
					)}
				/>
				<div class="absolute right-2 bottom-2 pointer-events-none">
					<Show when={isSaved()} fallback={<LoaderCircle class="w-4 h-4 animate-spin text-muted-foreground" />}>
						<Check class="w-4 h-4 text-emerald-500" />
					</Show>
				</div>
			</div>
		</div>
	);
}
