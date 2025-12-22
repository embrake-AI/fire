import { createFileRoute, Link, useSearch } from "@tanstack/solid-router";
import { ShieldX, TriangleAlert, UserX } from "lucide-solid";
import { Match, Switch } from "solid-js";
import { Button } from "~/components/ui/button";

export const Route = createFileRoute("/auth/error")({
	component: AuthErrorPage,
	validateSearch: (search: Record<string, unknown>) => ({
		error: (search.error as string) || "",
		message: (search.message as string) || "",
	}),
});

function AuthErrorPage() {
	const search = useSearch({ from: "/auth/error" });

	const isDomainNotAllowed = () => {
		const msg = search().error;
		return msg.includes("domain_is_not_allowed") || msg.includes("email_domain_not_allowed");
	};

	const isPersonalEmail = () => {
		const errorMsg = search().error?.toLowerCase() || "";
		return errorMsg.includes("personal_email_domains_are_not_allowed");
	};

	const isInvalidEmail = () => {
		const msg = search().message?.toLowerCase() || "";
		return msg.includes("invalid_email");
	};

	return (
		<div class="flex-1 flex flex-col items-center justify-center p-8">
			<div class="w-full max-w-md rounded-lg border border-border bg-card p-8 text-center space-y-6">
				<Switch
					fallback={
						<>
							<TriangleAlert class="mx-auto h-10 w-10 text-muted-foreground" />
							<div class="space-y-2">
								<h1 class="text-xl font-semibold text-card-foreground">Authentication Error</h1>
								<p class="text-sm text-muted-foreground">{search().message || "Something went wrong during sign in. Please try again."}</p>
							</div>
						</>
					}
				>
					<Match when={isDomainNotAllowed()}>
						<UserX class="mx-auto h-10 w-10 text-destructive-foreground" />
						<div class="space-y-2">
							<h1 class="text-xl font-semibold text-card-foreground">No Account Found</h1>
							<p class="text-sm text-muted-foreground">Your organization doesn't have an account with Fire yet.</p>
						</div>
						<p class="text-sm text-muted-foreground">
							Fire is available to organizations that have signed up. Reach out at{" "}
							<a href="mailto:miquelpuigturon@gmail.com" class="text-primary hover:underline">
								miquelpuigturon@gmail.com
							</a>{" "}
							to get started.
						</p>
					</Match>

					<Match when={isPersonalEmail()}>
						<ShieldX class="mx-auto h-10 w-10 text-amber-500" />
						<div class="space-y-2">
							<h1 class="text-xl font-semibold text-card-foreground">Company Email Required</h1>
							<p class="text-sm text-muted-foreground">{search().message}</p>
						</div>
						<p class="text-sm text-muted-foreground">Please sign in with your work email address to access Fire.</p>
					</Match>

					<Match when={isInvalidEmail()}>
						<ShieldX class="mx-auto h-10 w-10 text-muted-foreground" />
						<div class="space-y-2">
							<h1 class="text-xl font-semibold text-card-foreground">Invalid Email</h1>
							<p class="text-sm text-muted-foreground">We couldn't verify your email address. Please try again with a valid email.</p>
						</div>
					</Match>
				</Switch>

				<Button as={Link} to="/login" variant="outline" class="w-full">
					Back to Sign In
				</Button>
			</div>
		</div>
	);
}
