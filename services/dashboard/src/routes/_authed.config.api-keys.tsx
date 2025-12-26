import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createFileRoute } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { Check, Copy, Key, LoaderCircle, Plus, Trash2 } from "lucide-solid";
import { createSignal, For, Show, Suspense } from "solid-js";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Skeleton } from "~/components/ui/skeleton";
import { showToast } from "~/components/ui/toast";
import { createApiKey, getApiKeys, revokeApiKey } from "~/lib/api-keys";

// --- Name Generator ---

const adjectives = ["swift", "bold", "calm", "dark", "keen", "wild", "free", "warm", "cool", "bright", "quick", "still", "deep", "pure", "rare", "safe", "true", "wise", "fond"];
const nouns = ["fox", "owl", "bear", "wolf", "hawk", "lynx", "deer", "crow", "hare", "seal", "moth", "toad", "crab", "swan", "wasp", "mole", "dove", "jelly"];

function generateKeyName(): string {
	const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
	const noun = nouns[Math.floor(Math.random() * nouns.length)];
	const num = Math.floor(Math.random() * 1000);
	return `${adj}-${noun}-${num}`;
}

// --- Route ---

export const Route = createFileRoute("/_authed/config/api-keys")({
	component: ApiKeysConfig,
});

// --- Main Component ---

function ApiKeysConfig() {
	return (
		<Card>
			<CardHeader>
				<CardTitle>API Keys</CardTitle>
				<CardDescription>Manage API keys for programmatic access to incident metrics.</CardDescription>
			</CardHeader>
			<Suspense fallback={<ApiKeysContentSkeleton />}>
				<ApiKeysContent />
			</Suspense>
		</Card>
	);
}

// --- Skeleton ---

function ApiKeysContentSkeleton() {
	return (
		<CardContent>
			<div class="space-y-4">
				<Skeleton class="h-10 w-32" />
				<div class="space-y-3">
					<ApiKeyCardSkeleton />
					<ApiKeyCardSkeleton />
				</div>
			</div>
		</CardContent>
	);
}

function ApiKeyCardSkeleton() {
	return (
		<div class="flex items-center gap-4 p-4 border border-border rounded-lg bg-muted/30">
			<div class="flex items-center gap-2">
				<Skeleton variant="text" class="h-4 w-24" />
				<Skeleton variant="text" class="h-5 w-20" />
			</div>
			<div class="flex-1" />
			<div class="flex items-center gap-6">
				<Skeleton variant="text" class="h-3 w-32" />
				<Skeleton variant="text" class="h-3 w-28" />
			</div>
		</div>
	);
}

// --- Empty State ---

function ApiKeysEmptyState() {
	return (
		<div class="flex flex-col items-center justify-center py-12 border border-dashed border-border rounded-lg">
			<div class="relative mb-4">
				<div class="absolute inset-0 bg-blue-400/20 rounded-full blur-xl animate-pulse" />
				<div class="relative p-3 rounded-full bg-gradient-to-br from-blue-100 to-blue-50 border border-blue-200/60">
					<Key class="w-8 h-8 text-blue-600" />
				</div>
			</div>
			<h3 class="text-lg font-medium text-foreground mb-1">No API keys yet</h3>
			<p class="text-sm text-muted-foreground text-center max-w-sm">Create an API key to access incident metrics programmatically.</p>
		</div>
	);
}

// --- API Key Card ---

interface ApiKeyCardProps {
	id: string;
	name: string;
	keyPrefix: string;
	createdAt: Date | null;
	lastUsedAt: Date | null;
	onRevoke: (id: string) => void;
	isRevoking: boolean;
}

function ApiKeyCard(props: ApiKeyCardProps) {
	const formatDate = (date: Date | null) => {
		if (!date) return "Never";
		return new Intl.DateTimeFormat("en-US", {
			month: "short",
			day: "numeric",
			year: "numeric",
		}).format(new Date(date));
	};

	return (
		<div class="group flex items-center gap-4 p-4 border border-border rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
			<div class="flex items-center gap-2 min-w-0">
				<span class="font-medium text-foreground">{props.name}</span>
				<Badge variant="outline" class="font-mono text-xs">
					{props.keyPrefix}...
				</Badge>
			</div>
			<div class="flex-1" />
			<div class="flex items-center gap-6 text-xs text-muted-foreground">
				<span>Created {formatDate(props.createdAt)}</span>
				<span>
					<Show when={props.lastUsedAt} fallback={<span>Never used</span>}>
						Last used {formatDate(props.lastUsedAt)}
					</Show>
				</span>
			</div>
			<Button
				variant="ghost"
				size="icon"
				onClick={() => props.onRevoke(props.id)}
				disabled={props.isRevoking}
				class="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer h-8 w-8"
			>
				<Show when={props.isRevoking} fallback={<Trash2 class="w-4 h-4" />}>
					<LoaderCircle class="w-4 h-4 animate-spin" />
				</Show>
			</Button>
		</div>
	);
}

// --- Create Dialog ---

interface CreateApiKeyDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	keyName: string;
	onKeyNameChange: (name: string) => void;
	onCreate: () => void;
	isPending: boolean;
}

function CreateApiKeyDialog(props: CreateApiKeyDialogProps) {
	return (
		<Dialog open={props.open} onOpenChange={props.onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Create API Key</DialogTitle>
					<DialogDescription>Give your API key a name to help you identify it later.</DialogDescription>
				</DialogHeader>
				<div class="py-4">
					<Label for="key-name">Name</Label>
					<Input
						id="key-name"
						placeholder="e.g., Production Dashboard"
						value={props.keyName}
						onInput={(e) => props.onKeyNameChange(e.currentTarget.value)}
						onKeyDown={(e) => e.key === "Enter" && props.onCreate()}
					/>
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={() => props.onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={props.onCreate} disabled={!props.keyName.trim() || props.isPending}>
						<Show when={props.isPending}>
							<LoaderCircle class="w-4 h-4 animate-spin" />
						</Show>
						Create
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

// --- Key Created Dialog ---

interface KeyCreatedDialogProps {
	createdKey: { key: string; name: string } | null;
	onClose: () => void;
}

function KeyCreatedDialog(props: KeyCreatedDialogProps) {
	const [copied, setCopied] = createSignal(false);

	const handleCopy = async () => {
		const key = props.createdKey?.key;
		if (!key) return;
		await navigator.clipboard.writeText(key);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<Dialog open={!!props.createdKey} onOpenChange={() => props.onClose()}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>API Key Created</DialogTitle>
					<DialogDescription>Your new API key is ready to use.</DialogDescription>
				</DialogHeader>
				<div class="py-4 space-y-4">
					<div class="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-800">
						<div class="w-full space-y-0.5 text-center">
							<p class="text-sm font-medium">This is the only time you'll see this key.</p>
							<p class="text-sm text-amber-700">Copy it now and store it securely.</p>
						</div>
					</div>
					<div>
						<Label>Your API Key</Label>
						<div class="flex gap-2 mt-2">
							<Input value={props.createdKey?.key ?? ""} readOnly class="font-mono text-sm" />
							<Button variant="outline" size="icon" onClick={handleCopy} class="cursor-pointer">
								<Show when={copied()} fallback={<Copy class="w-4 h-4" />}>
									<Check class="w-4 h-4 text-emerald-600" />
								</Show>
							</Button>
						</div>
					</div>
					<p class="text-xs text-muted-foreground">
						Use the <code class="bg-muted px-1 rounded">X-API-Key</code> header to authenticate requests.
					</p>
				</div>
				<DialogFooter>
					<Button onClick={props.onClose}>Done</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

// --- Content ---

function ApiKeysContent() {
	const queryClient = useQueryClient();
	const [createDialogOpen, setCreateDialogOpen] = createSignal(false);
	const [newKeyName, setNewKeyName] = createSignal("");
	const [createdKey, setCreatedKey] = createSignal<{ key: string; name: string } | null>(null);

	const getApiKeysFn = useServerFn(getApiKeys);
	const apiKeysQuery = useQuery(() => ({
		queryKey: ["api-keys"],
		queryFn: getApiKeysFn,
		staleTime: 60_000,
	}));

	const createApiKeyFn = useServerFn(createApiKey);
	const createMutation = useMutation(() => ({
		mutationFn: createApiKeyFn,
		onSuccess: (result) => {
			setCreatedKey({ key: result.key, name: result.name });
			setCreateDialogOpen(false);
			setNewKeyName("");
			queryClient.invalidateQueries({ queryKey: ["api-keys"] });
		},
		onError: () => {
			showToast({
				title: "Failed to create API key",
				description: "Please try again.",
				variant: "error",
			});
		},
	}));

	const revokeApiKeyFn = useServerFn(revokeApiKey);
	const revokeMutation = useMutation(() => ({
		mutationFn: revokeApiKeyFn,
		onMutate: async ({ data }) => {
			await queryClient.cancelQueries({ queryKey: ["api-keys"] });
			const previousData = queryClient.getQueryData<typeof apiKeysQuery.data>(["api-keys"]);
			queryClient.setQueryData(["api-keys"], previousData?.filter((k) => k.id !== data.id) ?? []);
			return { previousData };
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["api-keys"] });
			showToast({
				title: "API key revoked",
				description: "The API key has been permanently deleted.",
				variant: "success",
			});
		},
		onError: (_err, _variables, context) => {
			if (context?.previousData) {
				queryClient.setQueryData(["api-keys"], context.previousData);
			}
			showToast({
				title: "Failed to revoke API key",
				description: "Please try again.",
				variant: "error",
			});
		},
	}));

	const handleOpenCreate = () => {
		if (!newKeyName().trim()) {
			setNewKeyName(generateKeyName());
		}
		setCreateDialogOpen(true);
	};

	const handleCreate = () => {
		if (!newKeyName().trim()) return;
		createMutation.mutate({ data: { name: newKeyName().trim() } });
	};

	const handleRevoke = (id: string) => {
		revokeMutation.mutate({ data: { id } });
	};

	return (
		<CardContent>
			<div class="space-y-4">
				<Button onClick={handleOpenCreate} size="sm">
					<Plus class="w-4 h-4" />
					Create API Key
				</Button>

				<Show when={apiKeysQuery.data && apiKeysQuery.data.length > 0} fallback={<ApiKeysEmptyState />}>
					<div class="space-y-3">
						<For each={apiKeysQuery.data}>
							{(key) => (
								<ApiKeyCard
									id={key.id}
									name={key.name}
									keyPrefix={key.keyPrefix}
									createdAt={key.createdAt}
									lastUsedAt={key.lastUsedAt}
									onRevoke={handleRevoke}
									isRevoking={revokeMutation.isPending && revokeMutation.variables?.data.id === key.id}
								/>
							)}
						</For>
					</div>
				</Show>
			</div>

			<CreateApiKeyDialog
				open={createDialogOpen()}
				onOpenChange={setCreateDialogOpen}
				keyName={newKeyName()}
				onKeyNameChange={setNewKeyName}
				onCreate={handleCreate}
				isPending={createMutation.isPending}
			/>

			<KeyCreatedDialog createdKey={createdKey()} onClose={() => setCreatedKey(null)} />
		</CardContent>
	);
}
