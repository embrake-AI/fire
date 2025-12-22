import { LoaderCircle } from "lucide-solid";
import { type Accessor, type JSX, Show } from "solid-js";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";

export type IntegrationCardProps = {
	/** Integration name displayed to user */
	name: string;
	/** Icon component for the integration */
	icon: JSX.Element;
	/** Whether the integration is currently connected */
	connected: Accessor<boolean>;
	/** Whether the connect/disconnect action is loading */
	loading?: boolean;
	/** Callback when disconnect is clicked */
	onDisconnect?: () => void;
	/** Callback when connect is clicked */
	onConnect?: () => void;
};

export function IntegrationCard(props: IntegrationCardProps) {
	return (
		<div class="flex items-center justify-between py-2">
			<div class="flex items-center">
				<div class="flex items-center">
					{props.icon}
					<span class="font-medium text-foreground">{props.name}</span>
				</div>
				<Show when={props.connected()}>
					<Badge class="ml-4 bg-emerald-100 text-emerald-700 border-emerald-200">Connected</Badge>
				</Show>
			</div>
			<Show
				when={props.connected()}
				fallback={
					<Button onClick={props.onConnect} disabled={props.loading} size="sm">
						<Show when={props.loading}>
							<LoaderCircle class="w-3.5 h-3.5 animate-spin" />
						</Show>
						Connect
					</Button>
				}
			>
				<Button onClick={props.onDisconnect} disabled={props.loading} variant="outline" size="sm">
					<Show when={props.loading}>
						<LoaderCircle class="w-3.5 h-3.5 animate-spin" />
					</Show>
					Disconnect
				</Button>
			</Show>
		</div>
	);
}
