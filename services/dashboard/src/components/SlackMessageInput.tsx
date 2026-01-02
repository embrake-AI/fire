import { useMutation, useQueryClient } from "@tanstack/solid-query";
import { Link } from "@tanstack/solid-router";
import { SendHorizontal } from "lucide-solid";
import { createEffect, createSignal, onMount, Show } from "solid-js";
import { loadEmojis, setCustomEmojis } from "~/lib/emoji/emoji";
import { sendSlackMessage } from "~/lib/incidents/incidents";
import { useIntegrations, useSlackEmojis } from "~/lib/integrations/integrations.hooks";
import { EmojiPicker } from "./EmojiPicker";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Textarea } from "./ui/textarea";
import { showToast } from "./ui/toast";

interface SlackMessageInputProps {
	incidentId: string;
	thread: string;
	channel: string;
}

export function SlackMessageInput(props: SlackMessageInputProps) {
	const [message, setMessage] = createSignal("");
	const [emojiQuery, setEmojiQuery] = createSignal("");
	const [showEmojiPicker, setShowEmojiPicker] = createSignal(false);
	const [pickerPosition, setPickerPosition] = createSignal({ top: 0, left: 0 });
	const [emojiStartPos, setEmojiStartPos] = createSignal(0);
	const queryClient = useQueryClient();
	const integrationsQuery = useIntegrations({ type: "user" });
	const slackEmojisQuery = useSlackEmojis();
	let textareaRef: HTMLTextAreaElement | undefined;

	const isConnected = () => integrationsQuery.data?.some((i) => i.platform === "slack") ?? false;

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
		mutationFn: (message: string) => sendSlackMessage({ data: { id: props.incidentId, message, thread_ts: props.thread, channel: props.channel } }),
		onSuccess: (data) => {
			if (data.error) {
				showToast({
					title: "Failed to send message",
					description: data.error,
					variant: "destructive",
				});
			} else {
				setMessage("");
				setTimeout(() => {
					void queryClient.invalidateQueries({ queryKey: ["incidents"] });
				}, 500);
			}
		},
	}));

	const handleSend = () => {
		if (!message().trim() || sendMessageMutation.isPending) return;
		sendMessageMutation.mutate(message());
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

			if (textareaRef) {
				const rect = textareaRef.getBoundingClientRect();
				setPickerPosition({
					top: rect.bottom + window.scrollY,
					left: rect.left + window.scrollX,
				});
			}
		} else {
			setShowEmojiPicker(false);
			setEmojiQuery("");
		}
	};

	const handleEmojiSelect = (shortcode: string, _emoji: string) => {
		const currentMessage = message();
		const start = emojiStartPos();
		const beforeEmoji = currentMessage.slice(0, start);
		const afterEmoji = currentMessage.slice(textareaRef?.selectionStart || start);
		const newMessage = `${beforeEmoji}:${shortcode}: ${afterEmoji}`;

		setMessage(newMessage);
		setShowEmojiPicker(false);
		setEmojiQuery("");

		setTimeout(() => {
			if (textareaRef) {
				const newCursorPos = start + shortcode.length + 3;
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
							placeholder={isConnected() ? "Type a message to send to Slack..." : "Connect Slack to send messages..."}
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
							disabled={!isConnected() || sendMessageMutation.isPending}
							class="min-h-25 pr-12 focus-visible:ring-1"
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
						<Show when={showEmojiPicker()}>
							<EmojiPicker query={emojiQuery()} onSelect={handleEmojiSelect} position={pickerPosition()} />
						</Show>
					</div>

					<Show when={!isConnected() && !integrationsQuery.isLoading}>
						<p class="text-sm text-muted-foreground">
							You need to connect Slack to send messages.{" "}
							<Link to="/settings/account/integrations" search={{}} class="text-primary hover:underline font-medium">
								Go to Integrations
							</Link>
						</p>
					</Show>
				</div>
			</CardContent>
		</Card>
	);
}
