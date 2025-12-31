import { createFileRoute } from "@tanstack/solid-router";
import { toSolidStartHandler } from "better-auth/solid-start";
import { auth } from "~/lib/auth/auth";

const { GET, POST } = toSolidStartHandler(auth);

export const Route = createFileRoute("/api/auth/$")({
	server: {
		handlers: {
			GET,
			POST,
		},
	},
});
