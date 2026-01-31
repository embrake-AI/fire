import { Hono } from "hono";
import { dashboardRoutes } from "./adapters/dashboard/receiver/routes";
import { slackRoutes } from "./adapters/slack/receiver/routes";

export { Incident } from "./core/incident";
export { IncidentAnalysisWorkflow } from "./dispatcher/analysis-workflow";
export { IncidentWorkflow } from "./dispatcher/workflow";

const app = new Hono<{ Bindings: Env }>();

app.route("/slack", slackRoutes);
app.route("/dashboard", dashboardRoutes);

export default app;
