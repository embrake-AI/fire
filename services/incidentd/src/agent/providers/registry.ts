export function getSimilarIncidentsProvider(env: Env, incidentId: string) {
	return env.SIMILAR_INCIDENTS_AGENT.getByName(incidentId);
}

export function getGitHubCommitsProvider(env: Env, incidentId: string) {
	return env.GITHUB_COMMITS_AGENT.getByName(incidentId);
}
