import { useQueryClient } from "@tanstack/solid-query";
import { Link, useNavigate } from "@tanstack/solid-router";
import { useServerFn } from "@tanstack/solid-start";
import { Building2, ChevronDown, Flame, LogOut, Settings } from "lucide-solid";
import { createSignal, Show, Suspense } from "solid-js";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { authClient } from "~/lib/auth/auth-client";
import { useClient } from "~/lib/client/client.hooks";
import { getIncidents } from "~/lib/incidents/incidents";
import StartIncidentButton from "./StartIncidentButton";

export default function Header() {
	const queryClient = useQueryClient();
	const getIncidentsFn = useServerFn(getIncidents);

	const prefetchIncidents = () => {
		const state = queryClient.getQueryState(["incidents"]);
		if (state?.status === "success" && !state.isInvalidated) {
			return;
		}
		void queryClient.prefetchQuery({
			queryKey: ["incidents"],
			queryFn: getIncidentsFn,
			staleTime: 10_000,
		});
	};

	return (
		<header class="px-6 py-4 flex items-center justify-between bg-white border-b border-zinc-200">
			<Link to="/" class="flex items-center gap-2 text-zinc-900 hover:text-zinc-700 transition-colors" onMouseEnter={prefetchIncidents} onFocusIn={prefetchIncidents}>
				<Flame class="w-6 h-6 text-orange-500" />
				<span class="text-lg font-semibold tracking-tight">Fire</span>
			</Link>
			<div class="flex items-center gap-3">
				<StartIncidentButton />
				<Link to="/config/entry-points" class="p-2 rounded-lg text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors">
					<Settings class="w-5 h-5" />
				</Link>
				<Suspense fallback={<WorkspaceButtonFallback />}>
					<WorkspaceButton />
				</Suspense>
			</div>
		</header>
	);
}

function WorkspaceButton() {
	const clientQuery = useClient();
	const navigate = useNavigate();
	const [open, setOpen] = createSignal(false);
	const [isSigningOut, setIsSigningOut] = createSignal(false);

	const handleSignOut = async () => {
		if (isSigningOut()) return;
		setIsSigningOut(true);
		try {
			await authClient.signOut();
		} finally {
			setIsSigningOut(false);
			setOpen(false);
			navigate({ to: "/login", search: { redirect: "/" } });
		}
	};

	return (
		<Popover open={open()} onOpenChange={setOpen}>
			<PopoverTrigger type="button" class="flex items-center gap-2 px-3 py-1.5 rounded-lg text-zinc-700 hover:text-zinc-900 hover:bg-zinc-100 transition-colors cursor-pointer">
				<Show
					when={clientQuery.data?.image}
					fallback={
						<div class="w-6 h-6 rounded bg-linear-to-br from-blue-100 to-blue-50 border border-blue-200 flex items-center justify-center">
							<Building2 class="w-3.5 h-3.5 text-blue-600" />
						</div>
					}
				>
					{(imageUrl) => <img src={imageUrl()} alt={clientQuery.data?.name} class="w-6 h-6 rounded object-cover" />}
				</Show>
				<span class="text-sm font-medium">{clientQuery.data?.name}</span>
				<ChevronDown class="w-4 h-4 text-zinc-400" />
			</PopoverTrigger>
			<PopoverContent class="w-44 p-1">
				<Link
					to="/settings"
					class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-zinc-700 hover:text-zinc-900 hover:bg-zinc-50 transition-colors cursor-pointer"
					onClick={() => setOpen(false)}
				>
					<Settings class="h-4 w-4 text-zinc-400" />
					Settings
				</Link>
				<button
					type="button"
					class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-zinc-700 hover:text-zinc-900 hover:bg-zinc-50 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
					onClick={handleSignOut}
					disabled={isSigningOut()}
				>
					<LogOut class="h-4 w-4 text-zinc-400" />
					{isSigningOut() ? "Logging out..." : "Log out"}
				</button>
			</PopoverContent>
		</Popover>
	);
}

function WorkspaceButtonFallback() {
	return (
		<div class="flex items-center gap-2 px-3 py-1.5">
			<div class="w-6 h-6 rounded bg-zinc-100 animate-pulse" />
			<div class="w-16 h-4 rounded bg-zinc-100 animate-pulse" />
		</div>
	);
}
