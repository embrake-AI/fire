import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/solid-start/plugin/vite";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import viteTsConfigPaths from "vite-tsconfig-paths";
import { workflow } from "workflow/vite";

const isProd = process.env.NODE_ENV === "production";
const workflowPlugins = workflow().filter((plugin) => plugin.name !== "workflow:hot-update");

export default defineConfig({
	server: {
		allowedHosts: ["glowing-externally-sloth.ngrok-free.app"],
	},
	plugins: [
		...workflowPlugins,
		!isProd && devtools(),
		viteTsConfigPaths({
			projects: ["./tsconfig.json"],
		}),
		tanstackStart({
			spa: {
				enabled: true,
			},
		}),
		nitro({
			preset: "vercel",
			vercel: {
				functions: {
					runtime: "bun1.x",
				},
			},
		}),
		tailwindcss(),
		solidPlugin({ ssr: true }),
	],
});
