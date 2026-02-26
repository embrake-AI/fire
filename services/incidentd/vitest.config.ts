import path from "node:path";
import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig(async () => {
	const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));

	return {
		test: {
			include: ["src/**/*.contract.test.ts"],
			setupFiles: ["./test/apply-migrations.ts"],
			poolOptions: {
				workers: {
					isolatedStorage: true,
					wrangler: {
						configPath: "./wrangler.jsonc",
					},
					miniflare: {
						bindings: {
							TEST_MIGRATIONS: migrations,
						},
					},
				},
			},
		},
	};
});
