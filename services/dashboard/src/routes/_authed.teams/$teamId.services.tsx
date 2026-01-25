import { createFileRoute } from "@tanstack/solid-router";
import { LoaderCircle, Plus, X } from "lucide-solid";
import { createSignal, Index, Show, Suspense } from "solid-js";
import { ServiceListCard } from "~/components/services/ServiceListCard";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Skeleton } from "~/components/ui/skeleton";
import { Textarea } from "~/components/ui/textarea";
import { useCreateService, useDeleteService, useServices } from "~/lib/services/services.hooks";

export const Route = createFileRoute("/_authed/teams/$teamId/services")({
	component: TeamServicesPage,
});

function TeamServicesPage() {
	const params = Route.useParams();

	return (
		<Suspense fallback={<ListSkeleton rows={2} />}>
			<Show when={params().teamId}>{(id) => <TeamServices teamId={id()} />}</Show>
		</Suspense>
	);
}

function TeamServices(props: { teamId: string }) {
	const servicesQuery = useServices();
	const services = () => servicesQuery.data?.filter((service) => service.teamOwnerIds.includes(props.teamId)) ?? [];

	const [isCreating, setIsCreating] = createSignal(false);

	const navigate = Route.useNavigate();

	const createMutation = useCreateService({
		onMutate: () => {
			setIsCreating(false);
		},
	});

	const deleteMutation = useDeleteService();

	const handleCreate = (name: string, description: string) => {
		createMutation.mutate({
			name: name.trim(),
			description: description.trim() ? description.trim() : null,
			teamOwnerIds: [props.teamId],
		});
	};

	const handleDelete = (id: string) => {
		deleteMutation.mutate(id);
	};

	const configuredCount = () => services().filter((service) => service.name.trim() && service.description?.trim()).length;

	return (
		<div class="space-y-6">
			<Show when={!isCreating()} fallback={<CreateServiceForm onSubmit={handleCreate} onCancel={() => setIsCreating(false)} isSubmitting={() => createMutation.isPending} />}>
				<div class="flex justify-end">
					<Button onClick={() => setIsCreating(true)} disabled={createMutation.isPending}>
						<Plus class="w-4 h-4 mr-2" />
						New Service
					</Button>
				</div>
			</Show>

			<Show
				when={services().length > 0}
				fallback={
					<Show when={!isCreating()}>
						<ServicesEmptyState />
					</Show>
				}
			>
				<div class="space-y-3">
					<Index each={services()}>
						{(service) => (
							<ServiceListCard
								service={service()}
								onOpen={() => navigate({ to: "/services/$serviceId", params: { serviceId: service().id } })}
								onDelete={() => handleDelete(service().id)}
								isDeleting={deleteMutation.isPending && deleteMutation.variables === service().id}
							/>
						)}
					</Index>
				</div>
			</Show>

			<ServicesFooter count={configuredCount()} />
		</div>
	);
}

interface CreateServiceFormProps {
	onSubmit: (name: string, description: string) => void;
	onCancel: () => void;
	isSubmitting: () => boolean;
}

function CreateServiceForm(props: CreateServiceFormProps) {
	const [name, setName] = createSignal("");
	const [description, setDescription] = createSignal("");

	const handleSubmit = (e: Event) => {
		e.preventDefault();
		props.onSubmit(name(), description());
	};

	return (
		<div class="border border-border rounded-lg bg-muted/20 overflow-hidden">
			<div class="flex items-center justify-between px-4 py-3 border-b border-border">
				<h4 class="text-sm font-medium text-foreground">Add service to team</h4>
				<Button variant="ghost" size="icon" class="h-8 w-8 cursor-pointer" onClick={props.onCancel}>
					<X class="w-4 h-4" />
				</Button>
			</div>
			<form onSubmit={handleSubmit} class="p-4 space-y-4">
				<div class="space-y-2">
					<Label for="team-service-name">Name</Label>
					<Input id="team-service-name" placeholder="e.g., Web App" value={name()} onInput={(e) => setName(e.currentTarget.value)} autofocus />
				</div>
				<div class="space-y-2">
					<Label for="team-service-description">Description</Label>
					<Textarea id="team-service-description" placeholder="What does this service do?" value={description()} onInput={(e) => setDescription(e.currentTarget.value)} rows={3} />
				</div>
				<div class="flex justify-end gap-2">
					<Button type="button" variant="ghost" onClick={props.onCancel}>
						Cancel
					</Button>
					<Button type="submit" disabled={props.isSubmitting()}>
						<Show when={props.isSubmitting()} fallback={<Plus class="w-4 h-4" />}>
							<LoaderCircle class="w-4 h-4 animate-spin" />
						</Show>
						Create
					</Button>
				</div>
			</form>
		</div>
	);
}

function ServicesFooter(props: { count: number }) {
	return (
		<Show when={props.count > 0}>
			<div class="pt-4 border-t border-border">
				<p class="text-sm text-muted-foreground">
					<span class="font-medium text-foreground">{props.count}</span> service{props.count !== 1 && "s"} configured
				</p>
			</div>
		</Show>
	);
}

function ServicesEmptyState() {
	return (
		<div class="flex flex-col items-center justify-center py-12 border border-dashed border-border rounded-lg">
			<h3 class="text-lg font-medium text-foreground mb-1">No services yet</h3>
			<p class="text-sm text-muted-foreground text-center max-w-sm">Add a service to track ownership for this team.</p>
		</div>
	);
}

function ListSkeleton(props: { rows?: number } = {}) {
	return (
		<div class="space-y-6">
			<div class="flex justify-end">
				<Skeleton class="h-10 w-32" />
			</div>
			<div class="space-y-3">
				<Index each={Array.from({ length: props.rows ?? 2 })}>{() => <Skeleton class="h-10 w-full" />}</Index>
			</div>
		</div>
	);
}
