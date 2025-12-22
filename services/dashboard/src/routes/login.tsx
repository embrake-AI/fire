import { useMutation } from "@tanstack/solid-query";
import { createFileRoute, useSearch } from "@tanstack/solid-router";
import { Flame } from "lucide-solid";
import { Button } from "~/components/ui/button";
import { authClient } from "~/lib/auth-client";

export const Route = createFileRoute("/login")({
	component: LoginPage,
	validateSearch: (search: Record<string, unknown>) => ({
		redirect: (search.redirect as string) || "/",
	}),
});

function LoginPage() {
	const search = useSearch({ from: "/login" });
	const callbackURL = search().redirect || "/";

	const doGoogle = useMutation(() => ({
		mutationFn: async () =>
			await authClient.signIn.social({
				provider: "google",
				callbackURL,
			}),
		onSuccess: (result) => {
			const url = result.data?.url;
			if (url) {
				window.location.href = url;
			}
		},
	}));

	return (
		<div class="min-h-screen bg-white flex flex-col items-center justify-center p-8 relative overflow-hidden">
			{/* Floating particles - in their own layer */}
			<div class="absolute inset-0 z-0 pointer-events-none" aria-hidden="true">
				<div class="particle" />
				<div class="particle" />
				<div class="particle" />
				<div class="particle" />
				<div class="particle" />
				<div class="particle" />
				<div class="particle" />
			</div>

			<div class="w-full max-w-sm flex flex-col items-center relative z-10">
				{/* Logo */}
				<div class="flex items-center gap-2 mb-3">
					<Flame class="w-8 h-8 text-orange-500" />
					<span class="text-3xl font-serif font-semibold text-zinc-900 tracking-tight">Fire</span>
				</div>

				{/* Decorative element */}
				<p class="text-orange-400/60 text-xs font-mono tracking-widest mb-10">· · · ◇ · · ·</p>

				{/* Welcome text */}
				<h1 class="text-lg font-medium text-zinc-900 mb-1 relative">Welcome back</h1>
				<p class="text-zinc-500 text-sm mb-8 relative">Sign in to continue to your dashboard</p>

				{/* Button */}
				<Button type="button" variant="outline" size="lg" onClick={() => doGoogle.mutate()} class="w-full bg-white" disabled={doGoogle.isPending}>
					<svg class="w-5 h-5" viewBox="0 0 24 24" role="img" aria-label="Google logo">
						<path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
						<path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
						<path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
						<path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
					</svg>
					Continue with Google
				</Button>
			</div>
		</div>
	);
}
