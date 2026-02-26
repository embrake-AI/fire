import type { IS_Event } from "@fire/common";
import { CircleCheck, Flame, MessageSquare, ShieldAlert, TriangleAlert, User } from "lucide-solid";
import type { Component } from "solid-js";
import { createMemo, Show } from "solid-js";
import { UserDisplay } from "~/components/MaybeUser";
import { Badge } from "~/components/ui/badge";
import { Tabs, TabsContent, TabsIndicator, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { replaceEmojis, useEmojis } from "./emoji/emoji";
import { getSeverity, getStatus } from "./incident-config";
import { useUserBySlackId } from "./users/users.hooks";

function EmojiText(props: { text: string; class?: string }) {
	const loaded = useEmojis();

	const html = createMemo(() => {
		loaded();
		return replaceEmojis(props.text);
	});

	return <span class={props.class} innerHTML={html()} />;
}

type EventType = IS_Event["event_type"];

type EventDataFor<T extends EventType> = Extract<IS_Event, { event_type: T }>["event_data"];

interface EventConfig<T extends EventType> {
	icon: Component<{ class?: string }>;
	iconBg: string;
	iconColor: string;
	label: string;
	render: Component<{ data: EventDataFor<T> }>;
}

type EventConfigMap = { [K in EventType]: EventConfig<K> };

export function getEventConfig<T extends EventType>(eventType: T): EventConfig<T> {
	return eventRegistry[eventType];
}

export const eventRegistry: EventConfigMap = {
	INCIDENT_CREATED: {
		icon: Flame,
		iconBg: "bg-red-100",
		iconColor: "text-red-600",
		label: "Incident Created",
		render: ({ data }) => {
			const severity = getSeverity(data.severity);
			const user = useUserBySlackId(() => data.assignee);
			return (
				<div class="space-y-4">
					<div class="flex items-center gap-3">
						<div class="flex items-center gap-2">
							<span class="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Severity</span>
							<span class={`text-sm font-bold ${severity.color} uppercase`}>{severity.label}</span>
						</div>
						<span class="text-muted-foreground/40">·</span>
						<div class="flex items-center gap-2">
							<span class="text-sm text-muted-foreground">Assigned to</span>
							<UserDisplay user={user} />
						</div>
					</div>

					<Tabs defaultValue="description" orientation="vertical" class="flex gap-0">
						<div class="flex-1 min-w-0 pr-4">
							<TabsContent value="description" class="mt-0">
								<Show when={data.description} fallback={<p class="text-sm text-muted-foreground italic">No description</p>}>
									<EmojiText text={data.description!} class="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap" />
								</Show>
							</TabsContent>
							<TabsContent value="prompt" class="mt-0">
								<p class="text-sm text-muted-foreground leading-relaxed font-mono bg-muted p-3 rounded-md">{data.prompt}</p>
							</TabsContent>
						</div>
						<TabsList class="flex-col items-stretch gap-0">
							<TabsTrigger value="description" class="text-xs py-1.5 justify-start">
								Description
							</TabsTrigger>
							<TabsTrigger value="prompt" class="text-xs py-1.5 justify-start">
								Original Prompt
							</TabsTrigger>
							<TabsIndicator class="left-0" />
						</TabsList>
					</Tabs>
				</div>
			);
		},
	},
	STATUS_UPDATE: {
		icon: ShieldAlert,
		iconBg: "bg-amber-100",
		iconColor: "text-amber-600",
		label: "Status Changed",
		render: ({ data }) => {
			const status = getStatus(data.status);
			const StatusIcon = data.status === "resolved" ? CircleCheck : ShieldAlert;
			return (
				<div class="space-y-2">
					<Badge class={`${status.bg} ${status.color} border-0 gap-1.5 px-3 py-1`}>
						<StatusIcon class="w-3.5 h-3.5" />
						<span class="font-semibold">{status.label}</span>
					</Badge>
					<Show when={data.message}>
						<p class="text-sm text-muted-foreground italic">
							"<EmojiText text={data.message!} />"
						</p>
					</Show>
				</div>
			);
		},
	},
	ASSIGNEE_UPDATE: {
		icon: User,
		iconBg: "bg-blue-100",
		iconColor: "text-blue-600",
		label: "Assignee Changed",
		render: ({ data }) => {
			const user = useUserBySlackId(() => data.assignee.slackId);
			return (
				<div class="flex items-center gap-2">
					<p class="text-sm text-muted-foreground">Assignee changed to</p>
					<UserDisplay user={user} />
				</div>
			);
		},
	},
	SEVERITY_UPDATE: {
		icon: TriangleAlert,
		iconBg: "bg-amber-100",
		iconColor: "text-amber-600",
		label: "Severity Changed",
		render: ({ data }) => {
			const severity = getSeverity(data.severity);
			return (
				<p class="text-sm text-muted-foreground">
					Severity changed to <span class={`font-medium ${severity.color}`}>{severity.label}</span>
				</p>
			);
		},
	},
	MESSAGE_ADDED: {
		icon: MessageSquare,
		iconBg: "bg-blue-100",
		iconColor: "text-blue-600",
		label: "New Message",
		render: ({ data }) => {
			const user = useUserBySlackId(() => data.userId);
			const isSystemUser = () => !data.userId || data.userId === "fire";
			const displayUser = () => (isSystemUser() ? { name: "Fire" } : user());
			return (
				<div class="flex items-start gap-2">
					<UserDisplay user={displayUser} />
					<EmojiText text={data.message} class="min-w-0 flex-1 text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap break-words" />
				</div>
			);
		},
	},
	AFFECTION_UPDATE: {
		icon: MessageSquare,
		iconBg: "bg-emerald-100",
		iconColor: "text-emerald-600",
		label: "Status Page Update",
		render: ({ data }) => {
			const statusLabel = data.status ? data.status.charAt(0).toUpperCase() + data.status.slice(1) : null;
			return (
				<div class="space-y-2">
					<Show when={statusLabel}>
						<Badge variant="outline" class="text-xs">
							{statusLabel}
						</Badge>
					</Show>
					<p class="text-sm text-muted-foreground">
						<EmojiText text={data.message} />
					</p>
				</div>
			);
		},
	},
} satisfies EventConfigMap;
