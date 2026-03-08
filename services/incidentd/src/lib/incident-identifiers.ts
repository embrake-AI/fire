export async function getIncidentIdByIdentifiers({
	incidents,
	clientId,
	identifiers,
}: {
	incidents: Env["incidents"];
	clientId: string;
	identifiers: string[];
}): Promise<string | null> {
	const normalizedIdentifiers = Array.from(new Set(identifiers.filter((identifier) => identifier)));
	if (!normalizedIdentifiers.length) {
		return null;
	}

	try {
		const placeholders = normalizedIdentifiers.map(() => "?").join(", ");
		const result = await incidents
			.prepare(
				`SELECT id
				FROM incident
				WHERE client_id = ?
					AND EXISTS (SELECT 1 FROM json_each(identifier) WHERE value IN (${placeholders}))
				ORDER BY createdAt DESC
				LIMIT 1`,
			)
			.bind(clientId, ...normalizedIdentifiers)
			.all<{ id: string }>();
		return result.results[0]?.id ?? null;
	} catch (error) {
		console.error("Failed to fetch incident by identifier", error);
		return null;
	}
}
