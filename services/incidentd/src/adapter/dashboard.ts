import { Hono } from "hono";
import { getIncident, listIncidents, startIncident, updateAssignee, updatePriority } from "../core/interactions";

const dashboardRoutes = new Hono<{ Bindings: Env }>();

dashboardRoutes.get("/", async (c) => {
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
	const id = crypto.randomUUID();
	const { prompt, createdBy } = await c.req.json<{
		prompt: string;
		createdBy: string;
	}>();
	const incident = await startIncident({
		c,
		identifier: id,
		prompt,
		createdBy,
		source: "dashboard",
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

dashboardRoutes.post("/:id/priority", async (c) => {
	const id = c.req.param("id");
	if (!id) {
		return c.json({ error: "ID is required" }, 400);
	}
	const { priority } = await c.req.json<{ priority: "low" | "medium" | "high" }>();

	if (!["low", "medium", "high"].includes(priority)) {
		return c.json({ error: "Invalid priority" }, 400);
	}

	const incident = await updatePriority({ c, id, priority });
	return c.json({ incident });
});

export { dashboardRoutes };
