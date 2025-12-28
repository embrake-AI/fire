import { useMutation, useQuery } from "@tanstack/solid-query";
import { Link } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { SendHorizontal } from "lucide-solid";
import { createSignal, Show } from "solid-js";
import { sendSlackMessage } from "~/lib/incidents";
import { getUserIntegrations } from "~/lib/integrations";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Textarea } from "./ui/textarea";

interface SlackMessageInputProps {
	incidentId: string;
	thread: string;
	channel: string;
}

export function SlackMessageInput(props: SlackMessageInputProps) {
	const [message, setMessage] = createSignal("");
	const getUserIntegrationsFn = useServerFn(getUserIntegrations);
	const integrationsQuery = useQuery(() => ({
		queryKey: ["user_integrations"],
		queryFn: getUserIntegrationsFn,
	}));

	const isConnected = () => integrationsQuery.data?.some((i) => i.platform === "slack") ?? false;

	const sendMessageMutation = useMutation(() => ({
		mutationFn: (message: string) => sendSlackMessage({ data: { id: props.incidentId, message, thread_ts: props.thread, channel: props.channel } }),
		onSuccess: () => {
			setMessage("");
		},
	}));

	const handleSend = () => {
		if (!message().trim() || sendMessageMutation.isPending) return;
		sendMessageMutation.mutate(message());
	};

	return (
		<Card>
			<CardContent class="pt-6">
				<div class="space-y-4">
					<div class="relative">
						<Textarea
							placeholder={isConnected() ? "Type a message to send to Slack..." : "Connect Slack to send messages..."}
							value={message()}
							onInput={(e) => setMessage(e.currentTarget.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter" && !e.shiftKey) {
									e.preventDefault();
									handleSend();
								}
							}}
							disabled={!isConnected() || sendMessageMutation.isPending}
							class="min-h-[100px] pr-12 focus-visible:ring-1"
						/>
						<div class="absolute right-3 bottom-3">
							<Button
								size="icon"
								variant="ghost"
								onClick={handleSend}
								disabled={!message().trim() || !isConnected() || sendMessageMutation.isPending}
								class="h-8 w-8 text-muted-foreground hover:text-foreground"
							>
								<SendHorizontal class="h-4 w-4" />
							</Button>
						</div>
					</div>

					<Show when={!isConnected() && !integrationsQuery.isLoading}>
						<p class="text-sm text-muted-foreground">
							You need to connect Slack to send messages.{" "}
							<Link to="/config/integrations" search={{}} class="text-primary hover:underline font-medium">
								Go to Integrations
							</Link>
						</p>
					</Show>
				</div>
			</CardContent>
		</Card>
	);
}
