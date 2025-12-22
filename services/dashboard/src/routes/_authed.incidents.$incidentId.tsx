import type { IS } from "@fire/common";
import { useQuery } from "@tanstack/solid-query";
import { createFileRoute, Link } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { ArrowLeft, User } from "lucide-solid";
import { createMemo, createSignal, Show } from "solid-js";
import { type SlackEntity, SlackEntityPicker } from "~/components/SlackEntityPicker";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger } from "~/components/ui/select";
import { getSlackUserGroups, getSlackUsers } from "~/lib/entry-points";
import { getSeverity, getStatus } from "~/lib/incident-config";
import { getIncidentById } from "~/lib/incidents";
import { useUpdateIncidentAssignee, useUpdateIncidentSeverity } from "~/lib/incidents.hooks";

export const Route = createFileRoute("/_authed/incidents/$incidentId")({
	component: IncidentDetail,
	loader: ({ params, context }) =>
		context.queryClient.prefetchQuery({
			queryKey: ["incident", params.incidentId],
			queryFn: () => getIncidentById({ data: { id: params.incidentId } }),
			staleTime: 5_000,
		}),
	errorComponent: () => (
		<div class="flex-1 bg-background flex items-center justify-center">
			<Card class="max-w-md text-center p-8">
				<CardHeader>
					<CardTitle>Incident Not Found</CardTitle>
					<CardDescription>The incident you're looking for doesn't exist.</CardDescription>
				</CardHeader>
				<CardContent>
					<Link to="/" class="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
						<ArrowLeft class="w-4 h-4" />
						Back to incidents
					</Link>
				</CardContent>
			</Card>
		</div>
	),
});

function IncidentHeader(props: { incident: IS }) {
	const updateSeverityMutation = useUpdateIncidentSeverity(props.incident.id);
	const updateAssigneeMutation = useUpdateIncidentAssignee(props.incident.id);

	const status = () => getStatus(props.incident.status);

	const getSlackUsersFn = useServerFn(getSlackUsers);
	const getSlackUserGroupsFn = useServerFn(getSlackUserGroups);
	const slackUsersQuery = useQuery(() => ({
		queryKey: ["slack-users"],
		queryFn: getSlackUsersFn,
	}));
	const slackGroupsQuery = useQuery(() => ({
		queryKey: ["slack-groups"],
		queryFn: getSlackUserGroupsFn,
	}));

	const assigneeName = createMemo(() => {
		if (!props.incident.assignee) return null;
		const user = slackUsersQuery.data?.find((u) => u.id === props.incident.assignee);
		if (user) return user.name;
		const group = slackGroupsQuery.data?.find((g) => g.id === props.incident.assignee);
		if (group) return group.name;
		return props.incident.assignee;
	});

	const [open, setOpen] = createSignal(false);

	const severityConfig = () => getSeverity(props.incident.severity);

	return (
		<div class="space-y-6">
			{/* Header */}
			<div class="space-y-4">
				{/* Title with status badge on the right */}
				<div class="flex items-start justify-between gap-4">
					<h1 class="text-3xl font-bold tracking-tight">{props.incident.title}</h1>
					<Badge round class={`${status().bg} ${status().color} border-transparent h-8 px-3 text-sm shrink-0`}>
						<span class={`w-2 h-2 rounded-full mr-2 ${status().dot}`} />
						{status().label}
					</Badge>
				</div>

				{/* Inline metadata controls */}
				<div class="flex flex-wrap items-center gap-3">
					{/* Severity Selector */}
					<Select
						value={props.incident.severity}
						onChange={(val) => val && updateSeverityMutation.mutate(val as IS["severity"])}
						options={["low", "medium", "high"]}
						itemComponent={(props) => {
							const config = getSeverity(props.item.rawValue as IS["severity"]);
							return (
								<SelectItem item={props.item}>
									<div class="flex items-center gap-2">
										<div class={`w-2 h-2 rounded-full ${config.dot}`} />
										<span class="capitalize">{props.item.rawValue}</span>
									</div>
								</SelectItem>
							);
						}}
					>
						<SelectTrigger class="w-32 h-8 gap-2 bg-muted/50 border-transparent hover:bg-muted">
							<div class={`w-2 h-2 rounded-full ${severityConfig().dot}`} />
							<span class="capitalize text-sm">{props.incident.severity}</span>
						</SelectTrigger>
						<SelectContent />
					</Select>

					<span class="text-muted-foreground/40">·</span>

					{/* Assignee Selector */}
					<Popover open={open()} onOpenChange={setOpen}>
						<PopoverTrigger as={Button} variant="ghost" size="sm" class="h-8 gap-2 bg-muted/50 hover:bg-muted font-normal">
							<User class="h-4 w-4 text-muted-foreground" />
							<span class="text-sm">{assigneeName() || "Unassigned"}</span>
						</PopoverTrigger>
						<PopoverContent class="p-0 w-[280px]">
							<SlackEntityPicker
								onSelect={(entity: SlackEntity) => {
									updateAssigneeMutation.mutate(entity.data.id);
									setOpen(false);
								}}
								selectedId={props.incident.assignee ?? undefined}
								placeholder="Change assignee..."
								emptyMessage="No users or groups found."
							/>
						</PopoverContent>
					</Popover>
				</div>
			</div>

			{/* Description */}
			<Card>
				<CardHeader>
					<CardTitle>Description</CardTitle>
				</CardHeader>
				<CardContent>
					<p class="text-muted-foreground leading-relaxed whitespace-pre-wrap">{props.incident.description}</p>
				</CardContent>
			</Card>

			{/* Original Prompt (Previous View) */}
			<Card>
				<CardHeader>
					<CardTitle>Original Prompt</CardTitle>
				</CardHeader>
				<CardContent>
					<p class="text-muted-foreground leading-relaxed font-mono text-sm bg-muted p-4 rounded-md">{props.incident.prompt}</p>
				</CardContent>
			</Card>
		</div>
	);
}

function IncidentDetail() {
	const params = Route.useParams();
	const incidentQuery = useQuery(() => ({
		queryKey: ["incident", params().incidentId],
		queryFn: () => getIncidentById({ data: { id: params().incidentId } }),
		refetchInterval: 5_000,
	}));
	const incident = () => incidentQuery.data;

	return (
		<div class="flex-1 bg-background p-6 md:p-8">
			<div class="max-w-5xl mx-auto">
				<Link to="/" class="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-6">
					<ArrowLeft class="w-4 h-4" />
					Back to incidents
				</Link>

				<Show when={incident()}>{(inc) => <IncidentHeader incident={inc()} />}</Show>
			</div>
		</div>
	);
}
