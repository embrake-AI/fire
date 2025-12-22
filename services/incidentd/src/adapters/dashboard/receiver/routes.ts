import { Hono } from "hono";
import { type BasicContext, getIncident, listIncidents, startIncident, updateAssignee, updateSeverity } from "../../../handler/index";
import { verifyDashboardRequestMiddleware } from "./middleware";

type DashboardContext = BasicContext & { Variables: { auth: { clientId: string; userId: string } } };

const dashboardRoutes = new Hono<DashboardContext>().use(verifyDashboardRequestMiddleware);

dashboardRoutes.get("/", async (c) => {
	// auth context available via c.get("auth") for future client-scoped queries
	return c.json({ incidents: await listIncidents({ c }) });
});

dashboardRoutes.get("/:id", async (c) => {
	const id = c.req.param("id");
	if (!id) {
		return c.json({ error: "ID is required" }, 400);
	}

	return c.json({ incident: await getIncident({ c, id }) });
});

dashboardRoutes.post("/", async (c) => {
	const auth = c.get("auth");
	const id = crypto.randomUUID();
	const { prompt } = await c.req.json<{
		prompt: string;
	}>();
	const incident = await startIncident({
		c,
		identifier: id,
		prompt,
		createdBy: auth.userId,
		source: "dashboard",
		m: {},
	});
	return c.json({ incident });
});

dashboardRoutes.post("/:id/assignee", async (c) => {
	const id = c.req.param("id");
	if (!id) {
		return c.json({ error: "ID is required" }, 400);
	}
	const { assignee } = await c.req.json<{ assignee: string }>();
	const incident = await updateAssignee({ c, id, assignee });
	return c.json({ incident });
});

dashboardRoutes.post("/:id/severity", async (c) => {
	const id = c.req.param("id");
	if (!id) {
		return c.json({ error: "ID is required" }, 400);
	}
	const { severity } = await c.req.json<{ severity: "low" | "medium" | "high" }>();

	if (!["low", "medium", "high"].includes(severity)) {
		return c.json({ error: "Invalid severity" }, 400);
	}

	const incident = await updateSeverity({ c, id, severity });
	return c.json({ incident });
});

export { dashboardRoutes };
