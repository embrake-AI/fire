import { Hono } from "hono";
import { dashboardRoutes } from "./adapter/dashboard/routes";
import { slackRoutes } from "./adapter/slack/routes";

export { Incident } from "./core/incident";

const app = new Hono<{ Bindings: Env }>();

// TODO: Add middleware auth here.
// we should be able to get
app.route("/slack", slackRoutes);
app.route("/dashboard", dashboardRoutes);

export default app;
