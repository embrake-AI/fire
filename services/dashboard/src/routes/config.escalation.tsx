import { createFileRoute } from "@tanstack/solid-router";
import { CircleArrowUp } from "lucide-solid";
import { Card } from "~/components/ui/card";

export const Route = createFileRoute("/config/escalation")({
	loader: async () => {
		return { escalation: "test" };
	},
	component: EscalationConfig,
});

function EscalationConfig() {
	return (
		<Card class="p-8">
			<div class="flex flex-col items-center justify-center py-8">
				<div class="relative mb-6">
					<div class="absolute inset-0 bg-amber-400/20 rounded-full blur-xl animate-pulse" />
					<div class="relative p-4 rounded-full bg-gradient-to-br from-amber-100 to-amber-50 border border-amber-200/60">
						<CircleArrowUp class="w-10 h-10 text-amber-600" />
					</div>
				</div>
				<h2 class="text-xl font-semibold text-foreground mb-2">Escalation Configuration</h2>
				<p class="text-muted-foreground text-center max-w-md">
					Define escalation policies and rules. Set up automatic escalation paths, timeouts, and notification preferences for unacknowledged incidents.
				</p>
			</div>
		</Card>
	);
}
