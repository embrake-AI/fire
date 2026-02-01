import { QueryClient, type QueryClientConfig } from "@tanstack/solid-query";
import { createRouter } from "@tanstack/solid-router";
import { isServer } from "solid-js/web";
import { routeTree } from "./routeTree.gen";

const queryClientOptions: QueryClientConfig = {
	defaultOptions: {
		queries: {
			retry: 1,
			refetchIntervalInBackground: false,
		},
		mutations: {
			retry: 0,
		},
	},
};

function createAppRouter(queryClient: QueryClient) {
	return createRouter({
		routeTree,
		context: { queryClient },
		defaultPreload: "intent",
	});
}

type AppRouter = ReturnType<typeof createAppRouter>;

let clientRouter: AppRouter | undefined;

function getClientQueryClient() {
	// Persist across HMR by stashing on globalThis
	const g = globalThis as unknown as { __QUERY_CLIENT__?: QueryClient };
	if (!g.__QUERY_CLIENT__) {
		g.__QUERY_CLIENT__ = new QueryClient(queryClientOptions);
	}
	return g.__QUERY_CLIENT__;
}

export const getRouter = () => {
	if (!isServer) {
		// client: reuse router + query client
		if (!clientRouter) {
			clientRouter = createAppRouter(getClientQueryClient());
		}
		return clientRouter;
	}

	// server side (only used to generate the shell in SPA mode)
	// safe: queries disabled by enabled: !isServer
	return createAppRouter(new QueryClient(queryClientOptions));
};
