import { type QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { createRootRouteWithContext, ErrorComponent, HeadContent, Outlet, Scripts, useRouter } from "@tanstack/solid-router";
import { Flame } from "lucide-solid";
import { createEffect, on, onMount, Show } from "solid-js";
import { HydrationScript } from "solid-js/web";
import { Button } from "~/components/ui/button";
import { Toaster } from "~/components/ui/toast";
import { initializeAuth, isAuthReady } from "~/lib/auth-store";
import styleCss from "~/styles.css?url";

interface RouterContext {
	queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
	// Auth is now bootstrapped client-side in RootShell, not in beforeLoad
	head: () => ({
		links: [
			{ rel: "stylesheet", href: styleCss },
			{ rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
		],
		meta: [{ charSet: "utf-8" }, { name: "viewport", content: "width=device-width, initial-scale=1" }],
	}),
	shellComponent: RootShell,
	notFoundComponent: NotFound,
	errorComponent: ErrorComponent,
	ssr: false,
});

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
	const router = useRouter();
	const queryClient = router.options.context.queryClient;

	onMount(() => {
		initializeAuth();
	});

	createEffect(
		on(isAuthReady, (r) => {
			if (r) router.invalidate();
		}),
	);

	return (
		<html lang="en">
			<head>
				<HydrationScript />
				<HeadContent />
			</head>
			<body class="min-h-screen flex flex-col">
				<QueryClientProvider client={queryClient}>
					<Show
						when={isAuthReady()}
						fallback={
							<main class="flex-1 flex items-center justify-center bg-background">
								<Flame class="w-8 h-8 text-orange-500/70 animate-pulse" />
							</main>
						}
					>
						<div class="flex flex-col flex-1">
							<Outlet />
						</div>
					</Show>
				</QueryClientProvider>
				<Toaster />
				<Scripts />
			</body>
		</html>
	);
}
