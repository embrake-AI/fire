import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/solid-start/plugin/vite";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import viteTsConfigPaths from "vite-tsconfig-paths";

const isProd = process.env.NODE_ENV === "production";

export default defineConfig({
	server: {
		allowedHosts: ["glowing-externally-sloth.ngrok-free.app"],
	},
	plugins: [
		!isProd && devtools(),
		nitro({
			vercel: {
				functions: {
					runtime: "bun1.x",
				},
			},
		}),
		viteTsConfigPaths({
			projects: ["./tsconfig.json"],
		}),
		tailwindcss(),
		tanstackStart(),
		solidPlugin({ ssr: true }),
	],
});
