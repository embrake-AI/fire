import type { Accessor } from "solid-js";
import { createEffect, createSignal, onCleanup } from "solid-js";

export function useDebounce<T>(value: Accessor<T>, delayMs: number): Accessor<T> {
	const [debouncedValue, setDebouncedValue] = createSignal(value());

	createEffect(() => {
		const nextValue = value();
		const timeout = setTimeout(() => {
			setDebouncedValue(() => nextValue);
		}, delayMs);

		onCleanup(() => clearTimeout(timeout));
	});

	return debouncedValue;
}
