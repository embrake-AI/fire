import { createFileRoute, Link } from "@tanstack/solid-router";
import { ArrowLeft, Clock, Tag } from "lucide-solid";
import { Show } from "solid-js";
import { Badge } from "~/components/ui/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
import { getSeverity, getStatus } from "~/lib/incident-config";
import { getIncidentById } from "~/lib/incidents";

export const Route = createFileRoute("/incidents/$incidentId")({
	component: IncidentDetail,
	loader: ({ params }) => getIncidentById({ data: { id: params.incidentId } }),
	errorComponent: () => (
		<div class="flex-1 bg-background flex items-center justify-center">
			<Card class="max-w-md text-center p-8">
				<CardHeader>
					<CardTitle>Incident Not Found</CardTitle>
					<CardDescription>
						The incident you're looking for doesn't exist.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Link
						to="/"
						class="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
					>
						<ArrowLeft class="w-4 h-4" />
						Back to incidents
					</Link>
				</CardContent>
			</Card>
		</div>
	),
});

function IncidentDetail() {
	const incident = Route.useLoaderData();

	return (
		<div class="flex-1 bg-background p-6 md:p-8">
			<div class="max-w-3xl mx-auto">
				<Link
					to="/"
					class="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-6"
				>
					<ArrowLeft class="w-4 h-4" />
					Back to incidents
				</Link>

				<Show when={incident()}>
					{(inc) => {
						const severity = () => getSeverity(inc().severity);
						const status = () => getStatus(inc().status);

						return (
							<Card class={`${severity().border} ${severity().bg}`}>
								<CardHeader>
									<div class="flex items-start gap-4">
										<div class={severity().color}>{severity().icon("md")}</div>
										<div class="flex-1">
											<CardTitle class="text-2xl text-foreground mb-2">
												{inc().prompt}
											</CardTitle>
											<CardDescription class="font-mono">
												{inc().id}
											</CardDescription>
										</div>
									</div>
								</CardHeader>

								<CardContent class="space-y-6">
									<div class="flex flex-wrap gap-3">
										<Badge
											round
											class={`${status().bg} ${status().color} border-transparent`}
										>
											<span
												class={`w-2 h-2 rounded-full mr-2 ${status().dot}`}
											/>
											{status().label}
										</Badge>
										<Badge
											variant="outline"
											round
											class={`${severity().bg} ${severity().color} border-transparent`}
										>
											<Tag class="w-3 h-3 mr-1.5" />
											{severity().label}
										</Badge>
										<Badge variant="secondary" round>
											<Clock class="w-3 h-3 mr-1.5" />
											{new Date(inc().createdAt).toLocaleString()}
										</Badge>
									</div>

									<div class="border-t border-border pt-6">
										<h2 class="text-lg font-semibold text-foreground mb-3">
											Description
										</h2>
										<p class="text-muted-foreground leading-relaxed">
											{inc().prompt}
										</p>
									</div>
								</CardContent>
							</Card>
						);
					}}
				</Show>
			</div>
		</div>
	);
}
