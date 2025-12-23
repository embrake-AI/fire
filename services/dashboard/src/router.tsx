import { isServer, QueryClient, type QueryClientConfig } from "@tanstack/solid-query";
import { createRouter } from "@tanstack/solid-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/solid-router-ssr-query";
import { routeTree } from "./routeTree.gen";

const queryClientOptions: QueryClientConfig = {
	defaultOptions: {
		queries: {
			// prevent SSR hang. (ssr sucks, why did I want to try it)
			enabled: !isServer,

			refetchOnWindowFocus: false,
			refetchOnMount: false,

			retry: 1,
		},
		mutations: {
			retry: 1,
		},
	},
};

function createAppRouter(queryClient: QueryClient) {
	const router = createRouter({
		routeTree,
		context: { queryClient, clientId: null, userId: null },
		defaultPreload: "intent",
	});

	setupRouterSsrQueryIntegration({ router, queryClient });
	return router;
}

type AppRouter = ReturnType<typeof createAppRouter>;

let clientRouter: AppRouter | undefined;

function getClientQueryClient() {
	// Persist across HMR by stashing on globalThis
	const g = globalThis as unknown as { __QUERY_CLIENT__: QueryClient | undefined };
	if (!g.__QUERY_CLIENT__) {
		const queryClient = new QueryClient(queryClientOptions);
		g.__QUERY_CLIENT__ = queryClient;
	}
	return g.__QUERY_CLIENT__;
}

export const getRouter = () => {
	if (typeof window !== "undefined") {
		// client: reuse router + query client
		if (!clientRouter) {
			clientRouter = createAppRouter(getClientQueryClient());
		}
		return clientRouter;
	} else {
		// server: per request
		const queryClient = new QueryClient(queryClientOptions);

		const router = createRouter({
			routeTree,
			context: {
				queryClient,
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
	}
};
