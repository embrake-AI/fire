import { ExternalLink, Server, TriangleAlert, Users } from "lucide-solid";
import { createMemo, Show } from "solid-js";
import { ConfigCard, ConfigCardActions, ConfigCardDeleteButton, ConfigCardIcon, ConfigCardRow, ConfigCardTitle } from "~/components/ui/config-card";
import type { getServices } from "~/lib/services/services";

type Service = Awaited<ReturnType<typeof getServices>>[number];

interface ServiceListCardProps {
	service: Service;
	onOpen: () => void;
	onDelete: () => void;
	isDeleting: boolean;
}

const MAX_DESC_LENGTH = 80;

function getFirstLine(text: string) {
	const firstLine = text.split("\n")[0] ?? "";
	return firstLine.length > MAX_DESC_LENGTH ? `${firstLine.slice(0, MAX_DESC_LENGTH)}...` : firstLine;
}

function getMissingLabel(missingName: boolean, missingDescription: boolean) {
	const missing: string[] = [];
	if (missingName) missing.push("name");
	if (missingDescription) missing.push("description");
	if (missing.length === 0) return "";
	if (missing.length === 1) return `Missing ${missing[0]}`;
	return `Missing ${missing.join(" and ")}`;
}

export function ServiceListCard(props: ServiceListCardProps) {
	const missingName = createMemo(() => !props.service.name?.trim());
	const missingDescription = createMemo(() => !props.service.description?.trim());
	const incomplete = createMemo(() => missingName() || missingDescription());
	const description = createMemo(() => props.service.description?.trim() ?? "");
	const missingLabel = createMemo(() => getMissingLabel(missingName(), missingDescription()));

	return (
		<ConfigCard hasWarning={incomplete()}>
			<ConfigCardRow onClick={props.onOpen} class="hover:bg-muted/50 transition-colors cursor-pointer">
				<Show
					when={props.service.imageUrl}
					fallback={
						<ConfigCardIcon variant="emerald" size="sm">
							<Server class="w-4 h-4" />
						</ConfigCardIcon>
					}
				>
					{(imageUrl) => <img src={imageUrl()} alt={props.service.name} class="w-8 h-8 rounded-lg object-cover shrink-0" />}
				</Show>

				<span class="flex-1 min-w-0">
					<span class="flex items-center gap-2">
						<ConfigCardTitle class="shrink-0">{missingName() ? "Untitled service" : props.service.name}</ConfigCardTitle>
						<Show
							when={!incomplete()}
							fallback={
								<span class="text-sm text-amber-600 flex items-center gap-1.5 min-w-0">
									<TriangleAlert class="w-3.5 h-3.5 shrink-0" />
									<span class="truncate">{missingLabel()} - can't be used</span>
								</span>
							}
						>
							<Show when={description()}>
								<span class="text-sm text-muted-foreground truncate min-w-0">- {getFirstLine(description())}</span>
							</Show>
						</Show>
					</span>
				</span>

				<div class="flex items-center gap-3 shrink-0">
					<span class="text-sm text-muted-foreground flex items-center gap-1">
						<Users class="w-3.5 h-3.5" />
						{props.service.teamOwnerIds.length} team{props.service.teamOwnerIds.length !== 1 && "s"}
					</span>
					<span class="text-sm text-muted-foreground">
						{props.service.userOwnerIds.length} owner{props.service.userOwnerIds.length !== 1 && "s"}
					</span>

					<ConfigCardActions animated>
						<ConfigCardDeleteButton onDelete={props.onDelete} isDeleting={props.isDeleting} />
					</ConfigCardActions>
					<ExternalLink class="w-4 h-4 text-muted-foreground" />
				</div>
			</ConfigCardRow>
		</ConfigCard>
	);
}
