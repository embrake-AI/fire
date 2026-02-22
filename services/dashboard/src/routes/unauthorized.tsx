import { createFileRoute } from "@tanstack/solid-router";
import { ShieldAlert } from "lucide-solid";
import { Button } from "~/components/ui/button";

export const Route = createFileRoute("/unauthorized")({
	component: UnauthorizedPage,
	validateSearch: (search: Record<string, unknown>) => ({
		from: typeof search.from === "string" ? search.from : undefined,
	}),
});

function UnauthorizedPage() {
	const search = Route.useSearch();

	return (
		<div class="flex-1 bg-background p-6 md:p-8 flex items-center justify-center">
			<div class="max-w-md w-full text-center space-y-4">
				<div class="mx-auto w-12 h-12 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center">
					<ShieldAlert class="w-6 h-6" />
				</div>
				<h1 class="text-2xl font-semibold text-foreground">Access denied</h1>
				<p class="text-muted-foreground">Your role does not have access to this page.</p>
				{search().from ? <p class="text-xs text-muted-foreground">Requested path: {search().from}</p> : null}
				<div class="pt-2">
					<Button onClick={() => window.history.back()}>Go back</Button>
				</div>
			</div>
		</div>
	);
}
