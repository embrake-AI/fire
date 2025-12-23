import { Hono } from "hono";
import { type BasicContext, getIncident, listIncidents, startIncident, updateAssignee, updateSeverity, updateStatus } from "../../../handler/index";
import { verifyDashboardRequestMiddleware } from "./middleware";

type DashboardContext = BasicContext & { Variables: { auth: { clientId: string; userId: string } } };

const dashboardRoutes = new Hono<DashboardContext>().use(verifyDashboardRequestMiddleware);

dashboardRoutes.get("/", async (c) => {
	return c.json({ incidents: await listIncidents({ c }) });
});

dashboardRoutes.get("/:id", async (c) => {
	const id = c.req.param("id");
	if (!id) {
		return c.json({ error: "ID is required" }, 400);
	}

	return c.json(await getIncident({ c, id }));
});

dashboardRoutes.post("/", async (c) => {
	const auth = c.get("auth");
	const id = crypto.randomUUID();
	const { prompt, metadata } = await c.req.json<{
		prompt: string;
		metadata?: Record<string, string>;
	}>();

	const incident = await startIncident({
		c,
		identifier: id,
		prompt,
		createdBy: auth.userId,
		source: "dashboard",
		m: metadata ?? {},
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

dashboardRoutes.post("/:id/status", async (c) => {
	const id = c.req.param("id");
	if (!id) {
		return c.json({ error: "ID is required" }, 400);
	}
	const { status, message } = await c.req.json<{ status: "mitigating" | "resolved"; message: string }>();

	if (!["mitigating", "resolved"].includes(status)) {
		return c.json({ error: "Invalid status" }, 400);
	}

	const incident = await updateStatus({ c, id, status, message });
	return c.json({ incident });
});

export { dashboardRoutes };
