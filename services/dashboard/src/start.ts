import { createStart } from "@tanstack/solid-start";
import { UserFacingErrorSerializationAdapter } from "./lib/errors/user-facing-error";

export const startInstance = createStart(() => ({
	serializationAdapters: [UserFacingErrorSerializationAdapter],
}));
