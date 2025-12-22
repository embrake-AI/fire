import { type QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from "@tanstack/solid-router";
import { Suspense } from "solid-js";
import { HydrationScript } from "solid-js/web";
import { Button } from "~/components/ui/button";
import { Toaster } from "~/components/ui/toast";
import { getContext } from "~/integrations/tanstack-query/provider";
import { getAuthContext } from "~/lib/auth-context";
import styleCss from "~/styles.css?url";

interface RouterContext {
	queryClient: QueryClient;
	clientId: string | null;
	userId: string | null;
}

export const Route = createRootRouteWithContext<RouterContext>()({
	beforeLoad: async () => {
		const { clientId, userId } = await getAuthContext();
		return { clientId, userId };
	},
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
			<Button as="a" href="/" variant="link" class="text-orange-400 hover:text-orange-300">
				Go back home
			</Button>
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
					<Suspense>
						<Outlet />
					</Suspense>
				</QueryClientProvider>
				<Toaster />
				<Scripts />
			</body>
		</html>
	);
}
