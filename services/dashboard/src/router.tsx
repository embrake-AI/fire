import { createRouter } from "@tanstack/solid-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/solid-router-ssr-query";
import { getContext } from "~/integrations/tanstack-query/provider";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
	const rqContext = getContext();

	const router = createRouter({
		routeTree,
		context: {
			...rqContext,
			// Auth context will be populated by root route's beforeLoad
			clientId: null,
			userId: null,
		},
		defaultPreload: "intent",
	});

	setupRouterSsrQueryIntegration({
		router,
		queryClient: rqContext.queryClient,
	});

	return router;
};
