import { type QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from "@tanstack/solid-router";
import { Suspense } from "solid-js";
import { HydrationScript } from "solid-js/web";

import Header from "~/components/Header";
import { getContext } from "~/integrations/tanstack-query/provider";
import styleCss from "~/styles.css?url";

interface RouterContext {
	queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
	head: () => ({
		links: [
			{ rel: "stylesheet", href: styleCss },
			{ rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
		],
		meta: [{ charSet: "utf-8" }, { name: "viewport", content: "width=device-width, initial-scale=1" }],
	}),
	shellComponent: RootShell,
	notFoundComponent: NotFound,
});

const { queryClient } = getContext();

function NotFound() {
	return (
		<div class="flex-1 flex flex-col items-center justify-center gap-4 p-8">
			<h1 class="text-4xl font-bold text-zinc-200">404</h1>
			<p class="text-zinc-400">Page not found</p>
			<a href="/" class="text-orange-400 hover:text-orange-300 underline">
				Go back home
			</a>
		</div>
	);
}

function RootShell() {
	return (
		<html lang="en">
			<head>
				<HydrationScript />
				<HeadContent />
			</head>
			<body class="min-h-screen flex flex-col">
				<QueryClientProvider client={queryClient}>
					<Header />
					<main class="flex-1 flex flex-col">
						<Suspense>
							<Outlet />
						</Suspense>
					</main>
				</QueryClientProvider>
				<Scripts />
			</body>
		</html>
	);
}
