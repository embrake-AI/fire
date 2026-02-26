import { useMutation, useQueryClient } from "@tanstack/solid-query";
import { Link } from "@tanstack/solid-router";
import { SendHorizontal } from "lucide-solid";
import { createEffect, createMemo, createSignal, onMount, Show } from "solid-js";
import { runDemoAware } from "~/lib/demo/runtime";
import { sendSlackMessageDemo } from "~/lib/demo/store";
import { loadEmojis, setCustomEmojis } from "~/lib/emoji/emoji";
import { sendSlackMessage } from "~/lib/incidents/incidents";
import { useIntegrations, useSlackEmojis } from "~/lib/integrations/integrations.hooks";
import { EmojiPicker } from "./EmojiPicker";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Textarea } from "./ui/textarea";

interface SlackMessageInputProps {
	incidentId: string;
	hasSlackContext: boolean;
}

export function SlackMessageInput(props: SlackMessageInputProps) {
	const [message, setMessage] = createSignal("");
	const [emojiQuery, setEmojiQuery] = createSignal("");
	const [showEmojiPicker, setShowEmojiPicker] = createSignal(false);
	const [emojiStartPos, setEmojiStartPos] = createSignal(0);
	const [draftMessageId, setDraftMessageId] = createSignal<string | null>(null);
	const queryClient = useQueryClient();
	const integrationsQuery = useIntegrations({ type: "user" });
	const slackEmojisQuery = useSlackEmojis();
	let textareaRef: HTMLTextAreaElement | undefined;

	const isUserConnected = () => integrationsQuery.data?.some((i) => i.platform === "slack") ?? false;
	const canSend = createMemo(() => (props.hasSlackContext ? isUserConnected() : true));
	const updateMessage = (nextMessage: string) => {
		if (nextMessage !== message()) {
			setDraftMessageId(null);
		}
		setMessage(nextMessage);
	};

	onMount(() => {
		loadEmojis();
	});

	createEffect(() => {
		const customEmojis = slackEmojisQuery.data;
		if (customEmojis) {
			setCustomEmojis(customEmojis);
		}
	});

	const sendMessageMutation = useMutation(() => ({
		mutationFn: (payload: { message: string; messageId: string }) =>
			runDemoAware({
				demo: () =>
					sendSlackMessageDemo({
						id: props.incidentId,
						message: payload.message,
						messageId: payload.messageId,
						sendAsBot: false,
					}),
				remote: () =>
					sendSlackMessage({
						data: {
							id: props.incidentId,
							message: payload.message,
							messageId: payload.messageId,
							sendAsBot: false,
							dashboardOnly: !props.hasSlackContext,
						},
					}),
			}),
		onSuccess: () => {
			setMessage("");
			setDraftMessageId(null);
			void queryClient.invalidateQueries({ queryKey: ["incident", props.incidentId] });
			void queryClient.invalidateQueries({ queryKey: ["incidents"] });
		},
	}));

	const handleSend = () => {
		if (!message().trim() || sendMessageMutation.isPending) return;
		const messageId = draftMessageId() ?? `dashboard-${crypto.randomUUID()}`;
		setDraftMessageId(messageId);
		sendMessageMutation.mutate({ message: message(), messageId });
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

		updateMessage(newMessage);
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
		updateMessage(newValue);
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
