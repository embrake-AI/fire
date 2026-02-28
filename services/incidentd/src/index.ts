import { Hono } from "hono";
import { dashboardRoutes } from "./adapters/dashboard/receiver/routes";
import { slackRoutes } from "./adapters/slack/receiver/routes";

export { SimilarIncidentsAgent } from "./agent/providers/similar-incidents-agent";
export { Incident } from "./core/incident";
export { IncidentAgentTurnWorkflow } from "./dispatcher/agent-turn-workflow";
export { IncidentAnalysisWorkflow } from "./dispatcher/analysis-workflow";
export { IncidentPromptWorkflow } from "./dispatcher/prompt-workflow";
export { IncidentWorkflow } from "./dispatcher/workflow";

const app = new Hono<{ Bindings: Env }>();

app.route("/slack", slackRoutes);
app.route("/dashboard", dashboardRoutes);

export default app;
