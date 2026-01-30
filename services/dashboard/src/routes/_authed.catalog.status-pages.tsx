import { createFileRoute } from "@tanstack/solid-router";
import { Activity, ExternalLink, LoaderCircle, Plus, X } from "lucide-solid";
import { createMemo, createSignal, For, Show, Suspense } from "solid-js";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { ConfigCard, ConfigCardActions, ConfigCardDeleteButton, ConfigCardDescription, ConfigCardIcon, ConfigCardRow, ConfigCardTitle } from "~/components/ui/config-card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Skeleton } from "~/components/ui/skeleton";
import { useCreateStatusPage, useDeleteStatusPage, useStatusPages } from "~/lib/status-pages/status-pages.hooks";

export const Route = createFileRoute("/_authed/catalog/status-pages")({
	component: StatusPagesConfig,
});

function StatusPagesConfig() {
	return (
		<Card class="p-6">
			<Suspense fallback={<StatusPagesContentSkeleton />}>
				<StatusPagesContent />
			</Suspense>
		</Card>
	);
}

function StatusPagesContent() {
	const statusPagesQuery = useStatusPages();
	const pages = () => statusPagesQuery.data ?? [];

	const [isCreating, setIsCreating] = createSignal(false);

	const navigate = Route.useNavigate();

	const createMutation = useCreateStatusPage({
		onMutate: () => {
			setIsCreating(false);
		},
	});
	const deleteMutation = useDeleteStatusPage();

	const handleCreate = (name: string, slug: string) => {
		createMutation.mutate({
			name: name.trim(),
			slug: slug.trim(),
		});
	};

	const handleDelete = (id: string) => {
		deleteMutation.mutate(id);
	};

	return (
		<div class="space-y-6">
			<Show when={!isCreating()} fallback={<CreateStatusPageForm onSubmit={handleCreate} onCancel={() => setIsCreating(false)} isSubmitting={() => createMutation.isPending} />}>
				<Button onClick={() => setIsCreating(true)} disabled={createMutation.isPending}>
					<Plus class="w-4 h-4" />
					Create Status Page
				</Button>
			</Show>

			<Show
				when={pages().length > 0}
				fallback={
					<Show when={!isCreating()}>
						<StatusPagesEmptyState />
					</Show>
				}
			>
				<div class="space-y-3">
					<For each={pages()}>
						{(page) => (
							<StatusPageCard
								page={page}
								onOpen={() => navigate({ to: "/status-page/$statusPageId", params: { statusPageId: page.id } })}
								onDelete={() => handleDelete(page.id)}
								isDeleting={deleteMutation.isPending && deleteMutation.variables === page.id}
							/>
						)}
					</For>
				</div>
			</Show>
		</div>
	);
}

// --- Create Status Page Form ---

function toSlug(value: string) {
	return value
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

interface CreateStatusPageFormProps {
	onSubmit: (name: string, slug: string) => void;
	onCancel: () => void;
	isSubmitting: () => boolean;
}

function CreateStatusPageForm(props: CreateStatusPageFormProps) {
	const [name, setName] = createSignal("");
	const [slug, setSlug] = createSignal("");
	const [slugEdited, setSlugEdited] = createSignal(false);

	const derivedSlug = createMemo(() => (slugEdited() ? slug() : toSlug(name())));
	const previewSlug = createMemo(() => toSlug(derivedSlug()));

	const handleNameChange = (value: string) => {
		setName(value);
		if (!slugEdited()) {
			setSlug(toSlug(value));
		}
	};

	const handleSlugChange = (value: string) => {
		setSlugEdited(true);
		setSlug(value);
	};

	const handleSubmit = (e: Event) => {
		e.preventDefault();
		props.onSubmit(name(), derivedSlug());
	};

	return (
		<div class="border border-border rounded-lg bg-muted/20 overflow-hidden">
			<div class="flex items-center justify-between px-4 py-3 border-b border-border">
				<h4 class="text-sm font-medium text-foreground">Create status page</h4>
				<Button variant="ghost" size="icon" class="h-8 w-8 cursor-pointer" onClick={props.onCancel}>
					<X class="w-4 h-4" />
				</Button>
			</div>
			<form onSubmit={handleSubmit} class="p-4 space-y-4">
				<div class="space-y-2">
					<Label for="status-page-name">Name</Label>
					<Input id="status-page-name" placeholder="e.g., Public Status" value={name()} onInput={(e) => handleNameChange(e.currentTarget.value)} autofocus />
				</div>
				<div class="space-y-2">
					<Label for="status-page-slug">URL slug</Label>
					<div class="flex items-center gap-2">
						<span class="text-sm text-muted-foreground shrink-0">/status/</span>
						<Input id="status-page-slug" placeholder="public-status" value={derivedSlug()} onInput={(e) => handleSlugChange(e.currentTarget.value)} class="flex-1" />
					</div>
					<Show when={previewSlug()}>
						<p class="text-xs text-muted-foreground">Will create /status/{previewSlug()}</p>
					</Show>
				</div>
				<div class="flex justify-end gap-2">
					<Button type="button" variant="ghost" onClick={props.onCancel}>
						Cancel
					</Button>
					<Button type="submit" disabled={props.isSubmitting() || !name().trim()}>
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

// --- Status Page Card ---

type StatusPage = NonNullable<ReturnType<typeof useStatusPages>["data"]>[number];

function StatusPageCard(props: { page: StatusPage; onOpen: () => void; onDelete: () => void; isDeleting: boolean }) {
	return (
		<ConfigCard>
			<ConfigCardRow onClick={props.onOpen} class="hover:bg-muted/50 transition-colors cursor-pointer">
				<ConfigCardIcon variant="slate" size="sm">
					<Activity class="w-4 h-4" />
				</ConfigCardIcon>
				<div class="flex-1 min-w-0">
					<ConfigCardTitle class="truncate">{props.page.name.trim() || "Untitled status page"}</ConfigCardTitle>
					<ConfigCardDescription class="truncate">{`/status/${props.page.slug}`}</ConfigCardDescription>
				</div>
				<div class="text-sm text-muted-foreground shrink-0">
					{props.page.serviceCount} service{props.page.serviceCount !== 1 && "s"}
				</div>
				<ConfigCardActions animated>
					<Button
						as="a"
						href={`/status/${props.page.slug}`}
						target="_blank"
						rel="noreferrer"
						variant="ghost"
						size="icon"
						class="h-8 w-8 text-muted-foreground hover:text-foreground"
						onClick={(e) => e.stopPropagation()}
					>
						<ExternalLink class="w-4 h-4" />
					</Button>
					<ConfigCardDeleteButton onDelete={props.onDelete} isDeleting={props.isDeleting} />
				</ConfigCardActions>
			</ConfigCardRow>
		</ConfigCard>
	);
}

// --- Skeleton ---

function StatusPagesContentSkeleton() {
	return (
		<div class="space-y-6">
			<Skeleton class="h-10 w-40" />
			<div class="space-y-3">
				<Skeleton class="h-14 w-full" />
				<Skeleton class="h-14 w-full" />
			</div>
		</div>
	);
}

// --- Empty State ---

function StatusPagesEmptyState() {
	return (
		<div class="flex flex-col items-center justify-center py-12 border border-dashed border-border rounded-lg">
			<div class="relative mb-4">
				<div class="absolute inset-0 bg-slate-400/20 rounded-full blur-xl animate-pulse" />
				<div class="relative p-3 rounded-full bg-gradient-to-br from-slate-100 to-slate-50 border border-slate-200/60">
					<Activity class="w-8 h-8 text-slate-600" />
				</div>
			</div>
			<h3 class="text-lg font-medium text-foreground mb-1">No status pages yet</h3>
			<p class="text-sm text-muted-foreground text-center max-w-sm">Create a status page to organize which services are publicly visible.</p>
		</div>
	);
}
