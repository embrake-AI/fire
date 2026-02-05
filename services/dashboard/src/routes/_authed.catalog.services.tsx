import { createFileRoute } from "@tanstack/solid-router";
import { LoaderCircle, Plus, Server, X } from "lucide-solid";
import { createSignal, Index, Show, Suspense } from "solid-js";
import { ServiceListCard } from "~/components/services/ServiceListCard";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Skeleton } from "~/components/ui/skeleton";
import { Textarea } from "~/components/ui/textarea";
import { useCreateService, useDeleteService, useServices } from "~/lib/services/services.hooks";

export const Route = createFileRoute("/_authed/catalog/services")({
	component: ServicesConfig,
});

function ServicesConfig() {
	return (
		<Card class="p-6">
			<Suspense fallback={<ServicesContentSkeleton />}>
				<ServicesContent />
			</Suspense>
		</Card>
	);
}

function ServicesContent() {
	const servicesQuery = useServices();
	const services = () => servicesQuery.data ?? [];

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
		});
	};

	const handleDelete = (id: string) => {
		deleteMutation.mutate(id);
	};

	const configuredCount = () => services().filter((service) => service.name.trim() && service.description?.trim()).length;

	return (
		<div class="space-y-6">
			<Show when={!isCreating()} fallback={<CreateServiceForm onSubmit={handleCreate} onCancel={() => setIsCreating(false)} isSubmitting={() => createMutation.isPending} />}>
				<Button onClick={() => setIsCreating(true)} disabled={createMutation.isPending}>
					<Plus class="w-4 h-4" />
					Create Service
				</Button>
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
				<h4 class="text-sm font-medium text-foreground">Create new service</h4>
				<Button variant="ghost" size="icon" class="h-8 w-8 cursor-pointer" onClick={props.onCancel}>
					<X class="w-4 h-4" />
				</Button>
			</div>
			<form onSubmit={handleSubmit} class="p-4 space-y-4">
				<div class="space-y-2">
					<Label for="service-name">Name</Label>
					<Input id="service-name" placeholder="e.g., Public API" value={name()} onInput={(e) => setName(e.currentTarget.value)} autofocus />
				</div>
				<div class="space-y-2">
					<Label for="service-description">Description</Label>
					<Textarea
						id="service-description"
						placeholder="What does this service do for customers?"
						value={description()}
						onInput={(e) => setDescription(e.currentTarget.value)}
						rows={3}
					/>
				</div>
				<div class="flex justify-end gap-2">
					<Button type="button" variant="ghost" onClick={props.onCancel}>
						Cancel
					</Button>
					<Button type="submit" disabled={!name().trim() || props.isSubmitting()}>
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
			<div class="relative mb-4">
				<div class="absolute inset-0 bg-emerald-400/20 rounded-full blur-xl animate-pulse" />
				<div class="relative p-3 rounded-full bg-gradient-to-br from-emerald-100 to-emerald-50 border border-emerald-200/60">
					<Server class="w-8 h-8 text-emerald-600" />
				</div>
			</div>
			<h3 class="text-lg font-medium text-foreground mb-1">No services yet</h3>
			<p class="text-sm text-muted-foreground text-center max-w-sm">Create a service to track ownership and impacted components.</p>
		</div>
	);
}

function ServicesContentSkeleton() {
	return (
		<div class="space-y-6">
			<Skeleton class="h-10 w-36" />
			<div class="space-y-3">
				<Skeleton class="h-14 w-full" />
				<Skeleton class="h-14 w-full" />
			</div>
			<Skeleton variant="text" class="h-4 w-32" />
		</div>
	);
}
