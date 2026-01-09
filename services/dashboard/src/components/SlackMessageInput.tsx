import { useMutation, useQueryClient } from "@tanstack/solid-query";
import { Link } from "@tanstack/solid-router";
import { ChevronDown, SendHorizontal } from "lucide-solid";
import { createEffect, createMemo, createSignal, onMount, Show } from "solid-js";
import { loadEmojis, setCustomEmojis } from "~/lib/emoji/emoji";
import { sendSlackMessage } from "~/lib/incidents/incidents";
import { useIntegrations, useSlackEmojis } from "~/lib/integrations/integrations.hooks";
import { EmojiPicker } from "./EmojiPicker";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Textarea } from "./ui/textarea";
import { showToast } from "./ui/toast";

interface SlackMessageInputProps {
	incidentId: string;
	lastEventId: number;
	hasSlackContext: boolean;
}

export function SlackMessageInput(props: SlackMessageInputProps) {
	const [message, setMessage] = createSignal("");
	const [emojiQuery, setEmojiQuery] = createSignal("");
	const [showEmojiPicker, setShowEmojiPicker] = createSignal(false);
	const [emojiStartPos, setEmojiStartPos] = createSignal(0);
	const [sendAsBot, setSendAsBot] = createSignal(false);
	const [senderPopoverOpen, setSenderPopoverOpen] = createSignal(false);
	const [lastEventId, setLastEventId] = createSignal(props.lastEventId);
	const queryClient = useQueryClient();
	const integrationsQuery = useIntegrations({ type: "user" });
	const slackEmojisQuery = useSlackEmojis();
	let textareaRef: HTMLTextAreaElement | undefined;

	const isUserConnected = () => integrationsQuery.data?.some((i) => i.platform === "slack") ?? false;
	const canSend = createMemo(() => (props.hasSlackContext ? isUserConnected() || sendAsBot() : true));

	onMount(() => {
		loadEmojis();
	});

	createEffect(() => {
		const customEmojis = slackEmojisQuery.data;
		if (customEmojis) {
			setCustomEmojis(customEmojis);
		}
	});

	createEffect(() => {
		setLastEventId((current) => Math.max(current, props.lastEventId));
	});

	const sendMessageMutation = useMutation(() => ({
		mutationFn: (payload: { message: string; lastEventId: number }) =>
			sendSlackMessage({
				data: {
					id: props.incidentId,
					message: payload.message,
					lastEventId: payload.lastEventId,
					sendAsBot: sendAsBot(),
					dashboardOnly: !props.hasSlackContext,
				},
			}),
		onMutate: (payload) => {
			const previousLastEventId = lastEventId();
			setLastEventId(payload.lastEventId + 1);
			return { previousLastEventId };
		},
		onSuccess: () => {
			setMessage("");
			void queryClient.invalidateQueries({ queryKey: ["incident", props.incidentId] });
			void queryClient.invalidateQueries({ queryKey: ["incidents"] });
		},
		onError: (error, _vars, context) => {
			if (context?.previousLastEventId !== undefined) {
				setLastEventId(context.previousLastEventId);
			}
			showToast({
				title: "Failed to send message",
				description: error instanceof Error ? error.message : "Unknown error",
				variant: "destructive",
			});
		},
	}));

	const handleSend = () => {
		if (!message().trim() || sendMessageMutation.isPending) return;
		sendMessageMutation.mutate({ message: message(), lastEventId: lastEventId() });
	};

	const detectEmojiTrigger = (text: string, cursorPos: number) => {
		const beforeCursor = text.slice(0, cursorPos);
		const match = beforeCursor.match(/:[\w\-+]*$/);

		if (match && match[0].length >= 3) {
			const query = match[0].slice(1);
			const startPos = cursorPos - match[0].length;
			setEmojiQuery(query);
			setEmojiStartPos(startPos);
			setShowEmojiPicker(true);
		} else {
			setShowEmojiPicker(false);
			setEmojiQuery("");
		}
	};

	const handleEmojiSelect = (shortcode: string, emoji: string) => {
		const currentMessage = message();
		const start = emojiStartPos();
		const beforeEmoji = currentMessage.slice(0, start);
		const afterEmoji = currentMessage.slice(textareaRef?.selectionStart || start);
		// Custom Slack emojis are URLs, so use shortcode format for those
		const isCustomEmoji = emoji.startsWith("http");
		const emojiText = isCustomEmoji ? `:${shortcode}:` : emoji;
		const newMessage = `${beforeEmoji}${emojiText} ${afterEmoji}`;

		setMessage(newMessage);
		setShowEmojiPicker(false);
		setEmojiQuery("");

		setTimeout(() => {
			if (textareaRef) {
				const newCursorPos = start + emojiText.length + 1;
				textareaRef.focus();
				textareaRef.setSelectionRange(newCursorPos, newCursorPos);
			}
		}, 0);
	};

	const handleInput = (e: InputEvent & { currentTarget: HTMLTextAreaElement }) => {
		const newValue = e.currentTarget.value;
		setMessage(newValue);
		detectEmojiTrigger(newValue, e.currentTarget.selectionStart);
	};

	return (
		<Card>
			<CardContent class="pt-6">
				<div class="space-y-4">
					<div class="relative">
						<Textarea
							ref={textareaRef}
							placeholder={props.hasSlackContext ? "Type a message to send to Slack..." : "Type a message to send to dashboard..."}
							value={message()}
							onInput={handleInput}
							onKeyDown={(e) => {
								if (e.key === "Enter" && !e.shiftKey) {
									e.preventDefault();
									handleSend();
								} else if (e.key === "Escape" && showEmojiPicker()) {
									e.preventDefault();
									setShowEmojiPicker(false);
									setEmojiQuery("");
								}
							}}
							disabled={!canSend() || sendMessageMutation.isPending}
							class="min-h-25 pr-12 focus-visible:ring-1"
						/>
						<div class="absolute right-3 bottom-3 flex items-center gap-2">
							<Show when={props.hasSlackContext}>
								<Popover open={senderPopoverOpen()} onOpenChange={setSenderPopoverOpen}>
									<PopoverTrigger as={Button} variant="ghost" size="sm" class="h-8 px-2 text-xs text-muted-foreground hover:text-foreground">
										{sendAsBot() ? "Bot" : "You"}
										<ChevronDown class="ml-1 h-3 w-3" />
									</PopoverTrigger>
									<PopoverContent class="w-48 p-2">
										<div class="space-y-1">
											<p class="text-xs text-muted-foreground px-2 py-1">Send as:</p>
											<button
												type="button"
												class="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted transition-colors cursor-pointer text-left disabled:opacity-50 disabled:cursor-not-allowed"
												disabled={!isUserConnected()}
												onClick={() => {
													setSendAsBot(false);
													setSenderPopoverOpen(false);
												}}
											>
												<span class="text-sm">Yourself</span>
												<Show when={!isUserConnected()}>
													<span class="text-xs text-muted-foreground">(not connected)</span>
												</Show>
											</button>
											<button
												type="button"
												class="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted transition-colors cursor-pointer text-left"
												onClick={() => {
													setSendAsBot(true);
													setSenderPopoverOpen(false);
												}}
											>
												<span class="text-sm">Bot</span>
											</button>
										</div>
									</PopoverContent>
								</Popover>
							</Show>
							<Button
								size="icon"
								variant="ghost"
								onClick={handleSend}
								disabled={!message().trim() || !canSend() || sendMessageMutation.isPending}
								class="h-8 w-8 text-muted-foreground hover:text-foreground"
							>
								<SendHorizontal class="h-4 w-4" />
							</Button>
						</div>
						<Show when={showEmojiPicker()}>
							<EmojiPicker query={emojiQuery()} onSelect={handleEmojiSelect} />
						</Show>
					</div>

					<Show when={props.hasSlackContext && !isUserConnected() && !integrationsQuery.isLoading}>
						<p class="text-sm text-muted-foreground">
							<Link to="/settings/account/integrations" search={{}} class="text-primary hover:underline font-medium">
								Connect Slack
							</Link>{" "}
							to send messages as yourself.
						</p>
					</Show>
				</div>
			</CardContent>
		</Card>
	);
}
