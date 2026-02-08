import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/solid-start/plugin/vite";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import viteTsConfigPaths from "vite-tsconfig-paths";
import { workflow } from "workflow/vite";

const isProd = process.env.NODE_ENV === "production";

export default defineConfig({
	server: {
		allowedHosts: ["glowing-externally-sloth.ngrok-free.app"],
	},
	plugins: [
		workflow(),
		!isProd && devtools(),
		viteTsConfigPaths({
			projects: ["./tsconfig.json"],
		}),
		tailwindcss(),
		tanstackStart({
			spa: {
				enabled: true,
			},
		}),
		solidPlugin({ ssr: true }),
		nitro({
			preset: "vercel",
			vercel: {
				functions: {
					runtime: "bun1.x",
				},
			},
		}),
	],
});
