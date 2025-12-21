export function ASSERT(condition: unknown, message?: string): asserts condition {
	if (!condition) {
		throw new Error(message ?? "Assertion failed");
	}
}
export function ASSERT_NEVER(condition: never): void {
	console.log(`ASSERT_NEVER: ${condition}`);
}
