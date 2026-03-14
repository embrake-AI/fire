import { useNavigate } from "@tanstack/solid-router";
import { createMemo } from "solid-js";

/**
 * Generic hook for type-safe, URL-synced filter parameters.
 *
 * `schema` maps each key to a parser that receives the raw search value
 * and returns the typed value (or undefined to omit it from the URL).
 *
 * Usage:
 *   const filters = useFilterParams(Route, {
 *     severity: parseArrayOf(["high", "medium", "low"] as const),
 *     showDeclined: parseBoolean,
 *   });
 *
 *   filters.get("severity")   // () => string[] | undefined
 *   filters.set("severity", ["high"])
 *   filters.clear("severity")
 *   filters.clearAll()
 */

type FilterSchema = Record<string, (raw: unknown) => unknown>;

export function useFilterParams<S extends FilterSchema>(route: { useSearch: () => () => Record<string, unknown> }, schema: S) {
	const search = route.useSearch();
	const navigate = useNavigate();
	const schemaKeys = Object.keys(schema) as Array<keyof S & string>;

	const values: Partial<{ [K in keyof S]: () => ReturnType<S[K]> }> = {};

	function createValueMemo<K extends keyof S & string>(key: K): () => ReturnType<S[K]> {
		const parser = schema[key] as (raw: unknown) => ReturnType<S[K]>;
		return createMemo<ReturnType<S[K]>>(() => parser(search()[key]));
	}

	for (const key of schemaKeys) {
		values[key] = createValueMemo(key);
	}

	function set<K extends keyof S & string>(key: K, value: ReturnType<S[K]>) {
		navigate({
			to: ".",
			search: (prev: Record<string, unknown>) => ({ ...prev, [key]: value }),
			replace: true,
		});
	}

	function clear(key: keyof S & string) {
		navigate({
			to: ".",
			search: (prev: Record<string, unknown>) => {
				const next = { ...prev };
				delete next[key];
				return next;
			},
			replace: true,
		});
	}

	function clearAll() {
		navigate({
			to: ".",
			search: {},
			replace: true,
		});
	}

	function get<K extends keyof S & string>(key: K): () => ReturnType<S[K]> {
		const value = values[key];
		if (!value) {
			throw new Error(`Missing filter accessor for "${key}"`);
		}
		return value;
	}

	const activeCount = createMemo(() => {
		let count = 0;
		for (const key of schemaKeys) {
			const v = schema[key](search()[key]);
			if (v !== undefined && v !== false && !(Array.isArray(v) && v.length === 0)) count++;
		}
		return count;
	});

	return { get, set, clear, clearAll, activeCount };
}

// --- Parsers ---

export function parseArrayOf<T extends string>(allowed: readonly T[]) {
	const allowedSet = new Set<string>(allowed);

	return (raw: unknown): T[] | undefined => {
		if (raw === undefined || raw === null || raw === "") return undefined;
		const items = (typeof raw === "string" ? raw.split(",") : Array.isArray(raw) ? raw : []).map((v: unknown) => String(v).trim()).filter((v): v is T => allowedSet.has(v));
		return items.length > 0 ? items : undefined;
	};
}

export function parseStringArray(raw: unknown): string[] | undefined {
	if (raw === undefined || raw === null || raw === "") return undefined;
	const items = (typeof raw === "string" ? raw.split(",") : Array.isArray(raw) ? raw : []).map((v: unknown) => String(v).trim()).filter((v) => v.length > 0);
	return items.length > 0 ? items : undefined;
}

export function parseBoolean(raw: unknown): boolean | undefined {
	if (raw === true || raw === "true" || raw === "1") return true;
	return undefined;
}
