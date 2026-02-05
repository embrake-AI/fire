import { Clock, Flame, Monitor } from "lucide-solid";
import type { Component } from "solid-js";
import { createEffect, For, onMount } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { SlackIcon } from "~/components/icons/SlackIcon";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { setCustomEmojis } from "~/lib/emoji/emoji";
import type { IncidentEvent } from "~/lib/incidents/incidents";
import { useSlackEmojis } from "~/lib/integrations/integrations.hooks";
import { getEventConfig } from "~/lib/timeline-events";

const ADAPTER_ICON = {
	slack: SlackIcon,
	dashboard: Monitor,
	fire: Flame,
} as const satisfies Record<"slack" | "dashboard" | "fire", Component>;

function formatTime(timestamp: string) {
	const date = new Date(timestamp);
	return date.toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

export function Timeline(props: { events: IncidentEvent[] }) {
	const [events, setEvents] = createStore<IncidentEvent[]>([]);
	const slackEmojisQuery = useSlackEmojis();

	createEffect(() => {
		const customEmojis = slackEmojisQuery.data;
		if (customEmojis) {
			setCustomEmojis(customEmojis);
		}
	});

	createEffect(() => {
		setEvents(reconcile(props.events, { key: "id" }));
	});

	return (
		<Card>
			<CardHeader>
				<CardTitle class="flex items-center gap-2 text-lg">
					<Clock class="w-5 h-5 text-muted-foreground" />
					Timeline
				</CardTitle>
			</CardHeader>
			<CardContent>
				<div>
					<div class="relative">
						<div class="absolute left-4 top-0 bottom-0 w-px bg-border" />
						<div class="space-y-6">
							<For each={events}>{(event) => <TimelineRow event={event} />}</For>
						</div>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}

export function TimelineRow(props: { event: IncidentEvent }) {
	const config = getEventConfig(props.event.event_type);
	const Icon = config.icon;
	const Render = config.render;
	const AdapterIcon = ADAPTER_ICON[props.event.adapter];

	const animationClasses = ["animate-in", "fade-in", "slide-in-from-top-2", "duration-300"];

	let el!: HTMLDivElement;

	onMount(() => {
		const handler = (e: AnimationEvent) => {
			if (e.target !== el) return;
			el.classList.remove(...animationClasses);
			el.removeEventListener("animationend", handler);
		};

		el.addEventListener("animationend", handler);
	});

	return (
		<div ref={el} class={`relative flex gap-4 pl-0 ${animationClasses.join(" ")}`}>
			<div class={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${config.iconBg}`}>
				<Icon class={`h-4 w-4 ${config.iconColor}`} />
			</div>
			<div class="flex-1 pt-0.5">
				<div class="flex items-center gap-2 mb-1">
					<span class="font-medium text-sm text-foreground">{config.label}</span>
					<span class="text-xs text-muted-foreground">{formatTime(props.event.created_at)}</span>
					<span class="text-muted-foreground/40">·</span>
					<Tooltip>
						<TooltipTrigger>
							<AdapterIcon class="w-3.5 h-3.5 text-muted-foreground/60" />
						</TooltipTrigger>
						<TooltipContent>
							<p class="text-[10px] capitalize">{props.event.adapter}</p>
						</TooltipContent>
					</Tooltip>
				</div>
				<Render data={props.event.event_data} />
			</div>
		</div>
	);
}
