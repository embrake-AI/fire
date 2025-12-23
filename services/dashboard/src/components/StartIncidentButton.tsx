import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { Link, useNavigate } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { Check, ChevronDown, Hash, Lock, Plus } from "lucide-solid";
import { createMemo, createSignal, For, Show } from "solid-js";
import { SlackIcon } from "~/components/icons/SlackIcon";
import { Button } from "~/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "~/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "~/components/ui/dialog";
import { Label } from "~/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { Switch, SwitchControl, SwitchLabel, SwitchThumb } from "~/components/ui/switch";
import { Textarea } from "~/components/ui/textarea";
import { getEntryPoints } from "~/lib/entry-points";
import { startIncident } from "~/lib/incidents";
import { getIntegrations, getSlackBotChannels } from "~/lib/integrations";
import type { SlackChannel } from "~/lib/slack";

export default function StartIncidentButton() {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const [open, setOpen] = createSignal(false);
	const [prompt, setPrompt] = createSignal("");
	const [postToSlack, setPostToSlack] = createSignal(false);
	const [selectedChannel, setSelectedChannel] = createSignal<SlackChannel | null>(null);
	const [channelPickerOpen, setChannelPickerOpen] = createSignal(false);

	const entryPointsQuery = useQuery(() => ({
		queryKey: ["entry-points"],
		queryFn: getEntryPoints,
	}));

	const integrationsQuery = useQuery(() => ({
		queryKey: ["integrations"],
		queryFn: getIntegrations,
	}));

	const slackChannelsQuery = useQuery(() => ({
		queryKey: ["slack-bot-channels"],
		queryFn: getSlackBotChannels,
		enabled: postToSlack(),
	}));

	const someEntryPoint = () => !!entryPointsQuery.data?.some((ep) => !!ep.prompt);
	const isSlackConnected = createMemo(() => integrationsQuery.data?.some((i) => i.platform === "slack") ?? false);

	const startIncidentFn = useServerFn(startIncident);
	const startIncidentMutation = useMutation(() => ({
		mutationFn: async (data: { prompt: string; slackChannelId?: string }) => startIncidentFn({ data }),
		onSuccess: (incident) => {
			queryClient.invalidateQueries({ queryKey: ["incidents"] });
			setOpen(false);
			setPrompt("");
			setPostToSlack(false);
			setSelectedChannel(null);
			navigate({ to: "/incidents/$incidentId", params: { incidentId: incident.id } });
		},
	}));

	const handleSubmit = (e: Event) => {
		e.preventDefault();
		startIncidentMutation.mutate({
			prompt: prompt(),
			slackChannelId: postToSlack() ? selectedChannel()?.id : undefined,
		});
	};

	const canSubmit = () => {
		if (!prompt().trim()) return false;
		if (postToSlack() && !selectedChannel()) return false;
		return true;
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

						<Show when={isSlackConnected()}>
							<div class="space-y-3">
								<Switch checked={postToSlack()} onChange={setPostToSlack} class="flex items-center gap-3">
									<SwitchControl>
										<SwitchThumb />
									</SwitchControl>
									<SlackIcon class="h-5 w-5" />
									<SwitchLabel>Also post on Slack</SwitchLabel>
								</Switch>
								<Show when={postToSlack()}>
									<Popover open={channelPickerOpen()} onOpenChange={setChannelPickerOpen}>
										<PopoverTrigger as={Button} variant="outline" size="sm" class="w-full justify-between" type="button">
											<Show when={selectedChannel()} fallback={<span class="text-muted-foreground">Choose a channel...</span>}>
												{(channel) => (
													<span class="flex items-center gap-2">
														{channel().isPrivate ? <Lock class="h-3.5 w-3.5" /> : <Hash class="h-3.5 w-3.5" />}
														{channel().name}
													</span>
												)}
											</Show>
											<ChevronDown class="ml-2 h-4 w-4 shrink-0 opacity-50" />
										</PopoverTrigger>
										<PopoverContent class="w-72 p-0">
											<Command>
												<CommandInput placeholder="Search channels..." />
												<CommandList>
													<Show when={!slackChannelsQuery.isPending} fallback={<div class="py-6 text-center text-sm text-muted-foreground">Loading channels...</div>}>
														<CommandEmpty>No channels found. Make sure the bot is invited to a channel.</CommandEmpty>
														<For each={slackChannelsQuery.data}>
															{(channel) => (
																<CommandItem
																	value={channel.name}
																	onSelect={() => {
																		setSelectedChannel(channel);
																		setChannelPickerOpen(false);
																	}}
																>
																	<div class="flex items-center gap-2 w-full">
																		{channel.isPrivate ? <Lock class="h-4 w-4 text-muted-foreground" /> : <Hash class="h-4 w-4 text-muted-foreground" />}
																		<span class="flex-1">{channel.name}</span>
																		<Show when={selectedChannel()?.id === channel.id}>
																			<Check class="h-4 w-4 text-primary" />
																		</Show>
																	</div>
																</CommandItem>
															)}
														</For>
													</Show>
												</CommandList>
											</Command>
										</PopoverContent>
									</Popover>
								</Show>
							</div>
						</Show>

						<DialogFooter>
							<Button type="submit" disabled={startIncidentMutation.isPending || !canSubmit()}>
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
