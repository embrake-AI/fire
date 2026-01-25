import { createFileRoute } from "@tanstack/solid-router";
import { Check, LoaderCircle, Pencil, Plus, Server, Users as UsersIcon, X } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Show, Suspense } from "solid-js";
import { EntityPicker } from "~/components/EntityPicker";
import { ImageUploadPicker } from "~/components/ImageUploadPicker";
import { UserAvatar } from "~/components/UserAvatar";
import { AutoSaveTextarea } from "~/components/ui/auto-save-textarea";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { ConfigCard, ConfigCardActions, ConfigCardDeleteButton, ConfigCardIcon, ConfigCardRow, ConfigCardTitle } from "~/components/ui/config-card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { Skeleton } from "~/components/ui/skeleton";
import type { getServices } from "~/lib/services/services";
import {
	useAddServiceDependency,
	useAddServiceTeamOwner,
	useAddServiceUserOwner,
	useRemoveServiceDependency,
	useRemoveServiceTeamOwner,
	useRemoveServiceUserOwner,
	useServices,
	useUpdateService,
} from "~/lib/services/services.hooks";
import { useTeams } from "~/lib/teams/teams.hooks";
import { useUploadImage } from "~/lib/uploads/uploads.hooks";
import { useUsers } from "~/lib/users/users.hooks";

export const Route = createFileRoute("/_authed/services/$serviceId")({
	component: ServiceDetailsPage,
});

type Service = Awaited<ReturnType<typeof getServices>>[number];

function ServiceDetailsPage() {
	const params = Route.useParams();
	const servicesQuery = useServices();

	const serviceId = createMemo(() => params().serviceId);
	const service = createMemo(() => servicesQuery.data?.find((s) => s.id === serviceId()));

	return (
		<div class="flex-1 bg-background p-6 md:p-8">
			<div class="max-w-6xl mx-auto space-y-6">
				<Suspense fallback={<ServiceDetailsSkeleton />}>
					<Show when={service()} fallback={<ServiceNotFound />}>
						{(data) => (
							<>
								<ServiceHeader service={data()} />
								<div class="grid gap-6 lg:grid-cols-[1fr_320px]">
									<div class="space-y-6">
										<ServiceDetailsPanel service={data()} />
										<ServiceDependenciesPanel service={data()} />
									</div>
									<ServiceOwnersPanel service={data()} />
								</div>
							</>
						)}
					</Show>
				</Suspense>
			</div>
		</div>
	);
}

function ServiceHeader(props: { service: Service }) {
	const updateServiceMutation = useUpdateService({
		onSuccess: () => setIsEditingName(false),
	});
	const uploadImageMutation = useUploadImage("service");

	const [isEditingName, setIsEditingName] = createSignal(false);
	const [isEditingImage, setIsEditingImage] = createSignal(false);
	const [name, setName] = createSignal(props.service.name);
	const [imageFile, setImageFile] = createSignal<File | null>(null);
	const [droppedImageUrl, setDroppedImageUrl] = createSignal("");

	createEffect(() => {
		setName(props.service.name);
	});

	const missingName = () => !props.service.name.trim();
	const missingDescription = () => !props.service.description?.trim();
	const isConfigured = () => !missingName() && !missingDescription();
	const missingSummary = () => {
		const missing: string[] = [];
		if (missingName()) missing.push("name");
		if (missingDescription()) missing.push("description");
		if (missing.length === 0) return "";
		if (missing.length === 1) return missing[0];
		return missing.join(" and ");
	};

	const handleUpdateName = () => {
		const trimmed = name().trim();
		updateServiceMutation.mutate({ id: props.service.id, name: trimmed });
	};

	const handleUpdateImage = async () => {
		const file = imageFile();
		const url = droppedImageUrl().trim();
		let uploadedUrl = props.service.imageUrl || "";

		if (file || url) {
			try {
				const { imageUrl } = await uploadImageMutation.mutateAsync({ file, url });
				uploadedUrl = imageUrl;
			} catch {
				return;
			}
		}

		setImageFile(null);
		setDroppedImageUrl("");
		setIsEditingImage(false);
		updateServiceMutation.mutate({ id: props.service.id, imageUrl: uploadedUrl || null });
	};

	return (
		<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
			<div class="flex items-center gap-4">
				<button
					type="button"
					class="relative h-16 w-16 rounded-xl overflow-hidden cursor-pointer bg-gradient-to-br from-emerald-100 to-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 shadow-sm p-0"
					onClick={() => setIsEditingImage(true)}
				>
					<Show when={props.service.imageUrl} fallback={<Server class="h-8 w-8" />}>
						{(imageUrl) => <img src={imageUrl()} alt={props.service.name} class="h-full w-full object-cover" />}
					</Show>
					<div class="absolute inset-0 bg-black/60 flex items-center justify-center transition-opacity duration-200 opacity-0 hover:opacity-100">
						<Pencil class="w-5 h-5 text-white" />
					</div>
				</button>

				<Dialog open={isEditingImage()} onOpenChange={setIsEditingImage}>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>Update Service Icon</DialogTitle>
						</DialogHeader>
						<ImageUploadPicker
							description="Choose or drop a file to replace the service icon."
							previewClass="h-16 w-16 overflow-hidden rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-100 to-emerald-50 shadow-sm"
							imageFile={imageFile}
							setImageFile={setImageFile}
							droppedImageUrl={droppedImageUrl}
							setDroppedImageUrl={setDroppedImageUrl}
							previewFallback={props.service.imageUrl}
							inputId="service-image-file"
						/>
						<DialogFooter>
							<Button variant="outline" onClick={() => setIsEditingImage(false)}>
								Cancel
							</Button>
							<Button onClick={handleUpdateImage} disabled={uploadImageMutation.isPending || updateServiceMutation.isPending}>
								<Show when={uploadImageMutation.isPending || updateServiceMutation.isPending} fallback="Save">
									<LoaderCircle class="w-4 h-4 animate-spin mr-2" />
									Saving...
								</Show>
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>

				<div class="space-y-2">
					<div class="flex flex-wrap items-center gap-2">
						<Show
							when={isEditingName()}
							fallback={
								<button type="button" class="flex items-center gap-2 group/title cursor-pointer bg-transparent border-none p-0" onClick={() => setIsEditingName(true)}>
									<h1 class="text-2xl font-bold tracking-tight">{props.service.name.trim() ? props.service.name : "Untitled service"}</h1>
									<Pencil class="w-4 h-4 text-muted-foreground opacity-0 group-hover/title:opacity-100 transition-opacity" />
								</button>
							}
						>
							<form
								class="flex items-center gap-2"
								onSubmit={(e) => {
									e.preventDefault();
									handleUpdateName();
								}}
								onFocusOut={(e) => {
									if (!e.currentTarget.contains(e.relatedTarget as Node) && !updateServiceMutation.isPending) {
										setIsEditingName(false);
									}
								}}
								onKeyDown={(e) => {
									if (e.key === "Escape") {
										setIsEditingName(false);
									}
								}}
							>
								<Input value={name()} onInput={(e) => setName(e.currentTarget.value)} class="h-9 text-lg font-bold w-full max-w-sm" autofocus />
								<Button size="sm" type="submit" disabled={updateServiceMutation.isPending}>
									<Show when={updateServiceMutation.isPending} fallback={<Check class="w-4 h-4" />}>
										<LoaderCircle class="w-4 h-4 animate-spin" />
									</Show>
								</Button>
							</form>
						</Show>
						<Show when={!isConfigured()}>
							<Badge variant="warning" round>
								Unconfigured
							</Badge>
						</Show>
					</div>
					<Show when={!isConfigured()}>
						<p class="text-sm text-amber-600">Missing {missingSummary()}. This service cannot be used yet.</p>
					</Show>
				</div>
			</div>
		</div>
	);
}

function ServiceDetailsPanel(props: { service: Service }) {
	const updateServiceMutation = useUpdateService();

	const handleSaveDescription = async (value: string) => {
		await updateServiceMutation.mutateAsync({ id: props.service.id, description: value.trim() ? value : null });
	};

	const handleSavePrompt = async (value: string) => {
		await updateServiceMutation.mutateAsync({ id: props.service.id, prompt: value.trim() ? value : null });
	};

	return (
		<Card class="p-6 space-y-6">
			<AutoSaveTextarea
				id="service-description"
				label="Description"
				placeholder="Describe what this service does for customers."
				value={props.service.description ?? ""}
				onSave={handleSaveDescription}
				rows={5}
			/>
			<AutoSaveTextarea
				id="service-prompt"
				label="AI Matching Prompt (recommended)"
				placeholder="This service is affected when..."
				value={props.service.prompt ?? ""}
				onSave={handleSavePrompt}
				rows={5}
			/>
		</Card>
	);
}

function ServiceOwnersPanel(props: { service: Service }) {
	const teamsQuery = useTeams();
	const usersQuery = useUsers();

	const addTeamOwnerMutation = useAddServiceTeamOwner();
	const removeTeamOwnerMutation = useRemoveServiceTeamOwner();
	const addUserOwnerMutation = useAddServiceUserOwner();
	const removeUserOwnerMutation = useRemoveServiceUserOwner();

	const teamOwners = createMemo(() => teamsQuery.data?.filter((team) => props.service.teamOwnerIds.includes(team.id)) ?? []);
	const availableTeams = createMemo(() => teamsQuery.data?.filter((team) => !props.service.teamOwnerIds.includes(team.id)) ?? []);
	const availableTeamEntities = createMemo(() => availableTeams().map((team) => ({ id: team.id, name: team.name, avatar: team.imageUrl })));

	const userOwners = createMemo(() => usersQuery.data?.filter((user) => props.service.userOwnerIds.includes(user.id)) ?? []);
	const eligibleUsers = createMemo(() => {
		const ownerTeamIds = new Set(props.service.teamOwnerIds);
		if (ownerTeamIds.size === 0) return [];
		return usersQuery.data?.filter((user) => user.teamIds.some((teamId) => ownerTeamIds.has(teamId)) && !props.service.userOwnerIds.includes(user.id)) ?? [];
	});
	const eligibleUserEntities = createMemo(() => eligibleUsers().map((user) => ({ id: user.id, name: user.name, avatar: user.image })));

	const handleAddTeam = (team: { id: string }) => {
		addTeamOwnerMutation.mutate({ serviceId: props.service.id, teamId: team.id });
	};

	const handleAddUser = (user: { id: string }) => {
		addUserOwnerMutation.mutate({ serviceId: props.service.id, userId: user.id });
	};

	return (
		<Card class="p-6 space-y-6">
			<div class="space-y-3">
				<div class="flex items-center justify-between">
					<h3 class="text-sm font-semibold text-foreground">Team owners</h3>
					<Popover>
						<PopoverTrigger as={Button} size="sm" disabled={availableTeams().length === 0 || addTeamOwnerMutation.isPending}>
							<Plus class="w-4 h-4 mr-1" />
							Add team
						</PopoverTrigger>
						<PopoverContent class="p-0" style={{ width: "240px" }}>
							<EntityPicker onSelect={handleAddTeam} entities={availableTeamEntities} placeholder="Select a team" emptyMessage="All teams are already owners." />
						</PopoverContent>
					</Popover>
				</div>
				<Show when={teamOwners().length > 0} fallback={<p class="text-sm text-muted-foreground">No team owners yet.</p>}>
					<div class="space-y-3">
						<For each={teamOwners()}>
							{(team) => (
								<ConfigCard>
									<ConfigCardRow>
										<UserAvatar name={() => team.name} avatar={() => team.imageUrl ?? undefined} />
										<ConfigCardTitle class="flex-1">{team.name}</ConfigCardTitle>
										<ConfigCardActions animated>
											<ConfigCardDeleteButton
												onDelete={() => removeTeamOwnerMutation.mutate({ serviceId: props.service.id, teamId: team.id })}
												isDeleting={removeTeamOwnerMutation.isPending && removeTeamOwnerMutation.variables?.teamId === team.id}
											/>
										</ConfigCardActions>
									</ConfigCardRow>
								</ConfigCard>
							)}
						</For>
					</div>
				</Show>
			</div>
			<div class="mt-6 space-y-3">
				<div class="flex items-center justify-between">
					<h3 class="text-sm font-semibold text-foreground">People in charge</h3>
					<Popover>
						<PopoverTrigger as={Button} size="sm" disabled={eligibleUsers().length === 0 || addUserOwnerMutation.isPending}>
							<Plus class="w-4 h-4 mr-1" />
							Add person
						</PopoverTrigger>
						<PopoverContent class="p-0" style={{ width: "240px" }}>
							<EntityPicker
								onSelect={handleAddUser}
								entities={eligibleUserEntities}
								placeholder="Select a user"
								emptyMessage={props.service.teamOwnerIds.length === 0 ? "Add a team owner first." : "No eligible users."}
							/>
						</PopoverContent>
					</Popover>
				</div>
				<Show
					when={userOwners().length > 0}
					fallback={
						<p class="text-sm text-muted-foreground">{props.service.teamOwnerIds.length === 0 ? "Add a team owner first to pick people in charge." : "No owners selected yet."}</p>
					}
				>
					<div class="space-y-3">
						<For each={userOwners()}>
							{(owner) => (
								<ConfigCard>
									<ConfigCardRow>
										<UserAvatar name={() => owner.name} avatar={() => owner.image ?? undefined} />
										<ConfigCardTitle class="flex-1">{owner.name}</ConfigCardTitle>
										<ConfigCardActions animated>
											<ConfigCardDeleteButton
												onDelete={() => removeUserOwnerMutation.mutate({ serviceId: props.service.id, userId: owner.id })}
												isDeleting={removeUserOwnerMutation.isPending && removeUserOwnerMutation.variables?.userId === owner.id}
											/>
										</ConfigCardActions>
									</ConfigCardRow>
								</ConfigCard>
							)}
						</For>
					</div>
				</Show>
			</div>
		</Card>
	);
}

function ServiceDependenciesPanel(props: { service: Service }) {
	const servicesQuery = useServices();
	const addDependencyMutation = useAddServiceDependency();
	const removeDependencyMutation = useRemoveServiceDependency();

	const otherServices = createMemo(() => servicesQuery.data?.filter((service) => service.id !== props.service.id) ?? []);
	const affectsServices = createMemo(() => servicesQuery.data?.filter((service) => props.service.affectsServiceIds.includes(service.id)) ?? []);
	const affectedByServices = createMemo(() => servicesQuery.data?.filter((service) => props.service.affectedByServiceIds.includes(service.id)) ?? []);

	const affectsEntities = createMemo(() =>
		otherServices()
			.filter((service) => !props.service.affectsServiceIds.includes(service.id))
			.map((service) => ({ id: service.id, name: service.name?.trim() || "Untitled service", avatar: service.imageUrl })),
	);
	const affectedByEntities = createMemo(() =>
		otherServices()
			.filter((service) => !props.service.affectedByServiceIds.includes(service.id))
			.map((service) => ({ id: service.id, name: service.name?.trim() || "Untitled service", avatar: service.imageUrl })),
	);

	const handleAddAffects = (service: { id: string }) => {
		addDependencyMutation.mutate({ baseServiceId: props.service.id, affectedServiceId: service.id });
	};

	const handleAddAffectedBy = (service: { id: string }) => {
		addDependencyMutation.mutate({ baseServiceId: service.id, affectedServiceId: props.service.id });
	};

	const handleRemoveAffects = (serviceId: string) => {
		removeDependencyMutation.mutate({ baseServiceId: props.service.id, affectedServiceId: serviceId });
	};

	const handleRemoveAffectedBy = (serviceId: string) => {
		removeDependencyMutation.mutate({ baseServiceId: serviceId, affectedServiceId: props.service.id });
	};

	return (
		<Card class="p-6 space-y-6">
			<div class="space-y-3">
				<div class="flex items-center justify-between">
					<h3 class="text-sm font-semibold text-foreground">Affects services</h3>
					<Popover>
						<PopoverTrigger as={Button} size="sm" disabled={affectsEntities().length === 0 || addDependencyMutation.isPending}>
							<Plus class="w-4 h-4 mr-1" />
							Add
						</PopoverTrigger>
						<PopoverContent class="p-0" style={{ width: "240px" }}>
							<EntityPicker onSelect={handleAddAffects} entities={affectsEntities} placeholder="Select a service" emptyMessage="No services to add." />
						</PopoverContent>
					</Popover>
				</div>
				<Show when={affectsServices().length > 0} fallback={<p class="text-sm text-muted-foreground">No affected services yet.</p>}>
					<div class="flex flex-wrap gap-2">
						<For each={affectsServices()}>
							{(service) => (
								<Badge variant="secondary" class="gap-1.5 pr-1.5">
									<Show
										when={service.imageUrl}
										fallback={<Server class="w-3.5 h-3.5 text-emerald-600" />}
									>
										{(imageUrl) => <img src={imageUrl()} alt={service.name ?? ""} class="w-3.5 h-3.5 rounded object-cover" />}
									</Show>
									{service.name?.trim() || "Untitled service"}
									<button
										type="button"
										class="rounded-full hover:bg-muted-foreground/20 p-0.5 transition-colors cursor-pointer"
										onClick={() => handleRemoveAffects(service.id)}
										disabled={removeDependencyMutation.isPending && removeDependencyMutation.variables?.affectedServiceId === service.id}
									>
										<Show
											when={removeDependencyMutation.isPending && removeDependencyMutation.variables?.affectedServiceId === service.id}
											fallback={<X class="w-3 h-3" />}
										>
											<LoaderCircle class="w-3 h-3 animate-spin" />
										</Show>
									</button>
								</Badge>
							)}
						</For>
					</div>
				</Show>
			</div>

			<div class="space-y-3">
				<div class="flex items-center justify-between">
					<h3 class="text-sm font-semibold text-foreground">Affected by services</h3>
					<Popover>
						<PopoverTrigger as={Button} size="sm" disabled={affectedByEntities().length === 0 || addDependencyMutation.isPending}>
							<Plus class="w-4 h-4 mr-1" />
							Add
						</PopoverTrigger>
						<PopoverContent class="p-0" style={{ width: "240px" }}>
							<EntityPicker onSelect={handleAddAffectedBy} entities={affectedByEntities} placeholder="Select a service" emptyMessage="No services to add." />
						</PopoverContent>
					</Popover>
				</div>
				<Show when={affectedByServices().length > 0} fallback={<p class="text-sm text-muted-foreground">No services affecting this yet.</p>}>
					<div class="flex flex-wrap gap-2">
						<For each={affectedByServices()}>
							{(service) => (
								<Badge variant="secondary" class="gap-1.5 pr-1.5">
									<Show
										when={service.imageUrl}
										fallback={<Server class="w-3.5 h-3.5 text-emerald-600" />}
									>
										{(imageUrl) => <img src={imageUrl()} alt={service.name ?? ""} class="w-3.5 h-3.5 rounded object-cover" />}
									</Show>
									{service.name?.trim() || "Untitled service"}
									<button
										type="button"
										class="rounded-full hover:bg-muted-foreground/20 p-0.5 transition-colors cursor-pointer"
										onClick={() => handleRemoveAffectedBy(service.id)}
										disabled={removeDependencyMutation.isPending && removeDependencyMutation.variables?.baseServiceId === service.id}
									>
										<Show
											when={removeDependencyMutation.isPending && removeDependencyMutation.variables?.baseServiceId === service.id}
											fallback={<X class="w-3 h-3" />}
										>
											<LoaderCircle class="w-3 h-3 animate-spin" />
										</Show>
									</button>
								</Badge>
							)}
						</For>
					</div>
				</Show>
			</div>
		</Card>
	);
}

function ServiceNotFound() {
	return (
		<Card class="p-6">
			<div class="flex flex-col items-center justify-center py-12">
				<div class="relative mb-4">
					<div class="absolute inset-0 bg-amber-400/20 rounded-full blur-xl animate-pulse" />
					<div class="relative p-3 rounded-full bg-gradient-to-br from-amber-100 to-amber-50 border border-amber-200/60">
						<UsersIcon class="w-8 h-8 text-amber-600" />
					</div>
				</div>
				<h3 class="text-lg font-medium text-foreground mb-1">Service not found</h3>
				<p class="text-sm text-muted-foreground">The service you are looking for does not exist.</p>
			</div>
		</Card>
	);
}

function ServiceDetailsSkeleton() {
	return (
		<div class="space-y-6">
			<div class="space-y-3">
				<Skeleton class="h-8 w-48" />
				<Skeleton class="h-4 w-72" />
			</div>
			<div class="grid gap-6 lg:grid-cols-[1fr_320px]">
				<Card class="p-6 space-y-4">
					<Skeleton class="h-4 w-24" />
					<Skeleton class="h-24 w-full" />
					<Skeleton class="h-4 w-40" />
					<Skeleton class="h-24 w-full" />
				</Card>
				<Card class="p-6 space-y-4">
					<Skeleton class="h-4 w-32" />
					<Skeleton class="h-10 w-full" />
					<Skeleton class="h-4 w-32" />
					<Skeleton class="h-10 w-full" />
				</Card>
			</div>
		</div>
	);
}
