import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { Link } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { Plus } from "lucide-solid";
import { createSignal, Show } from "solid-js";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "~/components/ui/dialog";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { getEntryPoints } from "~/lib/entry-points";
import { startIncident } from "~/lib/incidents";

export default function StartIncidentButton() {
	const queryClient = useQueryClient();
	const [open, setOpen] = createSignal(false);
	const [prompt, setPrompt] = createSignal("");

	const entryPointsQuery = useQuery(() => ({
		queryKey: ["entry-points"],
		queryFn: getEntryPoints,
	}));

	const someEntryPoint = () => !!entryPointsQuery.data?.some((ep) => !!ep.prompt);

	const startIncidentFn = useServerFn(startIncident);
	const startIncidentMutation = useMutation(() => ({
		mutationFn: async (data: { prompt: string }) => {
			await startIncidentFn({ data });
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["incidents"] });
			setOpen(false);
			setPrompt("");
		},
	}));

	const handleSubmit = (e: Event) => {
		e.preventDefault();
		startIncidentMutation.mutate({ prompt: prompt() });
	};

	return (
		<Dialog open={open()} onOpenChange={setOpen}>
			<DialogTrigger variant="outline" as={Button} size="sm">
				<Plus class="mr-2 h-4 w-4" /> Start Incident
			</DialogTrigger>
			<DialogContent class="sm:max-w-lg">
				<Show when={someEntryPoint()}>
					<DialogHeader>
						<DialogTitle>Start Incident</DialogTitle>
						<DialogDescription>This will trigger the most appropriate entry point and immediately notify its assignee according to the escalation path.</DialogDescription>
					</DialogHeader>
					<form onSubmit={handleSubmit} class="space-y-6 pt-4">
						<div>
							<Label for="prompt" class="mb-3 block">
								What's happening?
							</Label>
							<Textarea
								id="prompt"
								value={prompt()}
								onInput={(e) => setPrompt(e.currentTarget.value)}
								placeholder="e.g. Database returning connection errors, users unable to log in"
								rows={5}
								required
							/>
						</div>
						<DialogFooter>
							<Button type="submit" disabled={startIncidentMutation.isPending || !prompt().trim()}>
								{startIncidentMutation.isPending ? "Starting..." : "Start Incident"}
							</Button>
						</DialogFooter>
					</form>
				</Show>
				<Show when={!someEntryPoint()}>
					<DialogHeader class="space-y-3">
						<DialogTitle>No entry points configured</DialogTitle>
						<DialogDescription>You need at least one entry point with a prompt configured before you can start an incident.</DialogDescription>
					</DialogHeader>
					<DialogFooter class="pt-4">
						<Button as={Link} to="/config/entry-points" onClick={() => setOpen(false)}>
							<Plus class="mr-2 h-4 w-4" /> Add Entry Point
						</Button>
					</DialogFooter>
				</Show>
			</DialogContent>
		</Dialog>
	);
}
