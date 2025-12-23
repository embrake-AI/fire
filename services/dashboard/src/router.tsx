import { QueryClient } from "@tanstack/solid-query";
import { createRouter } from "@tanstack/solid-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/solid-router-ssr-query";
// import { getContext } from "~/integrations/tanstack-query/provider";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
	// const rqContext = getContext();
	const queryClient = new QueryClient();

	const router = createRouter({
		routeTree,
		context: {
			queryClient,
			// Auth context will be populated by root route's beforeLoad
			clientId: null,
			userId: null,
		},
		defaultPreload: "intent",
	});

	setupRouterSsrQueryIntegration({
		router,
		queryClient,
	});

	return router;
};
