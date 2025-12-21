import { Hono } from "hono";
import { dashboardRoutes } from "./adapter/dashboard";
import { slackRoutes } from "./adapter/slack";

export { Incident } from "./core/incident";

const app = new Hono<{ Bindings: Env }>();

app.route("/slack", slackRoutes);
app.route("/dashboard", dashboardRoutes);

export default app;
