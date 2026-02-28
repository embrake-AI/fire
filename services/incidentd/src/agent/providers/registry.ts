export function getSimilarIncidentsProvider(env: Env, incidentId: string) {
	return env.SIMILAR_INCIDENTS_AGENT.getByName(incidentId);
}
