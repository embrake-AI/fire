export async function createWorkflowIfMissing(create: () => Promise<unknown>) {
	try {
		await create();
		return true;
	} catch (error) {
		if (error instanceof Error && /already.*exist/i.test(error.message)) {
			return false;
		}
		throw error;
	}
}
