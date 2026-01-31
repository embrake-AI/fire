import type { EntryPoint, IS_Event } from "@fire/common";
import { Hono } from "hono";
import { addMessage, type BasicContext, getIncident, listIncidents, startIncident, updateAffection, updateAssignee, updateSeverity, updateStatus } from "../../../handler/index";
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
	const { prompt, metadata, entryPoints, services } = await c.req.json<{
		prompt: string;
		metadata?: Record<string, string>;
		entryPoints: EntryPoint[];
		services: { id: string; prompt: string | null }[];
	}>();
	const normalizedServices = Array.isArray(services) ? services.filter((service) => service?.id).map((service) => ({ id: service.id, prompt: service.prompt ?? null })) : [];

	const incidentId = await startIncident({
		c,
		identifier: id,
		prompt,
		createdBy: auth.userId,
		source: "dashboard",
		entryPoints,
		services: normalizedServices,
		m: metadata ?? {},
	});
	return c.json({ id: incidentId });
});

dashboardRoutes.post("/:id/assignee", async (c) => {
	const id = c.req.param("id");
	if (!id) {
		return c.json({ error: "ID is required" }, 400);
	}
	const body = await c.req.json<{ slackId: string }>();
	const incident = await updateAssignee({ c, id, assignee: { slackId: body.slackId }, adapter: "dashboard" });
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

	const incident = await updateSeverity({ c, id, severity, adapter: "dashboard" });
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

	const incident = await updateStatus({ c, id, status, message, adapter: "dashboard" });
	return c.json({ incident });
});

dashboardRoutes.post("/:id/message", async (c) => {
	const id = c.req.param("id");
	if (!id) {
		return c.json({ error: "ID is required" }, 400);
	}
	const { message, slackUserId, messageId, slackUserToken } = await c.req.json<{
		message: string;
		slackUserId: string;
		messageId: string;
		slackUserToken?: string;
	}>();

	await addMessage({ c, id, message, userId: slackUserId, messageId, adapter: "dashboard", slackUserToken });
	return c.json({ success: true });
});

dashboardRoutes.post("/:id/affection", async (c) => {
	const id = c.req.param("id");
	if (!id) {
		return c.json({ error: "ID is required" }, 400);
	}
	const auth = c.get("auth");
	const { title, services, message } = await c.req.json<{ title: string; services: { id: string; impact: "partial" | "major" }[]; message: string }>();

	const trimmedTitle = title?.trim() ?? "";
	const trimmedMessage = message?.trim() ?? "";

	if (!trimmedTitle) {
		return c.json({ error: "Title is required" }, 400);
	}
	if (!trimmedMessage) {
		return c.json({ error: "Message is required" }, 400);
	}
	if (!Array.isArray(services) || services.length === 0) {
		return c.json({ error: "At least one service is required" }, 400);
	}

	const uniqueServices = Array.from(new Map(services.map((entry) => [entry.id, entry])).values());
	const normalizedServices = uniqueServices.filter((entry) => entry.id && (entry.impact === "partial" || entry.impact === "major"));
	if (normalizedServices.length !== uniqueServices.length) {
		return c.json({ error: "Invalid services payload" }, 400);
	}
	const update: Extract<IS_Event, { event_type: "AFFECTION_UPDATE" }>["event_data"] = {
		message: trimmedMessage,
		status: "investigating",
		title: trimmedTitle,
		services: normalizedServices,
		createdBy: auth.userId,
	};

	const result = await updateAffection({ c, id, update, adapter: "dashboard" });
	if (result && "error" in result) {
		return c.json({ error: result.error }, 400);
	}

	return c.json({ success: true });
});

dashboardRoutes.post("/:id/affection/update", async (c) => {
	const id = c.req.param("id");
	if (!id) {
		return c.json({ error: "ID is required" }, 400);
	}
	const auth = c.get("auth");
	const { message, status } = await c.req.json<{ message: string; status?: "investigating" | "mitigating" | "resolved" }>();

	const trimmedMessage = message?.trim() ?? "";
	if (!trimmedMessage) {
		return c.json({ error: "Message is required" }, 400);
	}
	if (status && !["investigating", "mitigating", "resolved"].includes(status)) {
		return c.json({ error: "Invalid status" }, 400);
	}

	const update: Extract<IS_Event, { event_type: "AFFECTION_UPDATE" }>["event_data"] = {
		message: trimmedMessage,
		createdBy: auth.userId,
		...(status ? { status } : {}),
	};

	const result = await updateAffection({ c, id, update, adapter: "dashboard" });
	if (result && "error" in result) {
		return c.json({ error: result.error }, 400);
	}

	return c.json({ success: true });
});

export { dashboardRoutes };
