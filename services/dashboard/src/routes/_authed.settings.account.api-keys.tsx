import { useMutation, useQueryClient } from "@tanstack/solid-query";
import { createFileRoute } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { Check, Copy, Key, LoaderCircle, Plus } from "lucide-solid";
import { createSignal, For, Show, Suspense } from "solid-js";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Skeleton } from "~/components/ui/skeleton";
import { showToast } from "~/components/ui/toast";
import { createApiKey, revokeApiKey } from "~/lib/api-keys/api-keys";
import { useApiKeys } from "~/lib/api-keys/api-keys.hooks";
import { requireRoutePermission } from "~/lib/auth/route-guards";
import { runDemoAware } from "~/lib/demo/runtime";
import { createApiKeyDemo, revokeApiKeyDemo } from "~/lib/demo/store";

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

export const Route = createFileRoute("/_authed/settings/account/api-keys")({
	beforeLoad: requireRoutePermission("apiKeys.read"),
	component: ApiKeysPage,
});

// --- Main Component ---

function ApiKeysPage() {
	return (
		<div class="space-y-8">
			<div>
				<h2 class="text-lg font-semibold text-foreground">API Keys</h2>
				<p class="text-sm text-muted-foreground mt-1">Manage your personal API keys for programmatic access</p>
			</div>

			<Suspense fallback={<ApiKeysSkeleton />}>
				<ApiKeysContent />
			</Suspense>
		</div>
	);
}

// --- Skeleton ---

function ApiKeysSkeleton() {
	return (
		<div class="rounded-xl bg-muted/20 px-4 py-4">
			<div class="space-y-3">
				<ApiKeyRowSkeleton />
				<ApiKeyRowSkeleton />
			</div>
		</div>
	);
}

function ApiKeyRowSkeleton() {
	return (
		<div class="flex items-center gap-3 py-3 border-b border-border/40 last:border-0">
			<Skeleton class="h-8 w-8 rounded-lg" />
			<div class="flex-1 space-y-1">
				<Skeleton variant="text" class="h-4 w-24" />
				<Skeleton variant="text" class="h-3 w-32" />
			</div>
			<Skeleton class="h-8 w-16 rounded-md" />
		</div>
	);
}

// --- Empty State ---

function ApiKeysEmptyState() {
	return (
		<div class="flex flex-col items-center justify-center py-8 text-center">
			<div class="relative mb-4">
				<div class="absolute inset-0 bg-blue-400/20 rounded-full blur-xl animate-pulse" />
				<div class="relative p-3 rounded-full bg-gradient-to-br from-blue-100 to-blue-50 border border-blue-200/60">
					<Key class="w-6 h-6 text-blue-600" />
				</div>
			</div>
			<h3 class="text-sm font-medium text-foreground mb-1">No API keys yet</h3>
			<p class="text-xs text-muted-foreground max-w-xs">Create an API key to access incident metrics programmatically.</p>
		</div>
	);
}

// --- API Key Row ---

interface ApiKeyRowProps {
	id: string;
	name: string;
	keyPrefix: string;
	createdAt: Date | null;
	lastUsedAt: Date | null;
	onRevoke: (id: string) => void;
	isRevoking: boolean;
}

function ApiKeyRow(props: ApiKeyRowProps) {
	const formatDate = (date: Date | null) => {
		if (!date) return "Never";
		return new Intl.DateTimeFormat("en-US", {
			month: "short",
			day: "numeric",
			year: "numeric",
		}).format(new Date(date));
	};

	return (
		<div class="flex items-center gap-3 py-3 border-b border-border/40 last:border-0">
			<div class="p-2 rounded-lg bg-zinc-100 border border-zinc-200">
				<Key class="w-4 h-4 text-zinc-600" />
			</div>
			<div class="flex-1 min-w-0">
				<div class="flex items-center gap-2">
					<span class="text-sm font-medium text-foreground truncate">{props.name}</span>
					<Badge variant="outline" class="font-mono text-xs shrink-0">
						{props.keyPrefix}...
					</Badge>
				</div>
				<div class="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
					<span>Created {formatDate(props.createdAt)}</span>
					<span class="text-border">·</span>
					<Show when={props.lastUsedAt} fallback={<span>Never used</span>}>
						Last used {formatDate(props.lastUsedAt)}
					</Show>
				</div>
			</div>
			<Button variant="ghost" size="sm" class="text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => props.onRevoke(props.id)} disabled={props.isRevoking}>
				{props.isRevoking ? <LoaderCircle class="w-4 h-4 animate-spin" /> : "Revoke"}
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

	const apiKeysQuery = useApiKeys();

	const createApiKeyFn = useServerFn(createApiKey);
	const createMutation = useMutation(() => ({
		mutationFn: (data: { data: { name: string } }) =>
			runDemoAware({
				demo: () => createApiKeyDemo(data.data),
				remote: () => createApiKeyFn(data),
			}),
		onSuccess: (result) => {
			setCreatedKey({ key: result.key, name: result.name });
			setCreateDialogOpen(false);
			setNewKeyName("");
			queryClient.invalidateQueries({ queryKey: ["api-keys"] });
		},
	}));

	const revokeApiKeyFn = useServerFn(revokeApiKey);
	const revokeMutation = useMutation(() => ({
		mutationFn: (data: { data: { id: string } }) =>
			runDemoAware({
				demo: () => revokeApiKeyDemo(data.data),
				remote: () => revokeApiKeyFn(data),
			}),
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
		<div>
			<div class="rounded-xl bg-muted/20 px-4 py-2">
				<Show when={apiKeysQuery.data && apiKeysQuery.data.length > 0} fallback={<ApiKeysEmptyState />}>
					<div class="divide-y divide-border/40">
						<For each={apiKeysQuery.data}>
							{(key) => (
								<ApiKeyRow
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

			<div class="mt-4">
				<Button variant="outline" size="sm" onClick={handleOpenCreate}>
					<Plus class="w-4 h-4" />
					Create API Key
				</Button>
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
		</div>
	);
}
