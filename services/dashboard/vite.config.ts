import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import viteTsConfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'

import { tanstackStart } from '@tanstack/solid-start/plugin/vite'
import solidPlugin from 'vite-plugin-solid'
import { nitro } from 'nitro/vite'

const isProd = process.env.NODE_ENV === 'production'

export default defineConfig({
    plugins: [
        !isProd && devtools(),
        nitro({
            vercel: {
                functions: {
                    runtime: 'bun1.x',
                },
            },
        }),
        viteTsConfigPaths({
            projects: ['./tsconfig.json'],
        }),
        tailwindcss(),
        tanstackStart(),
        solidPlugin({ ssr: true }),
    ],
    ssr: {
        external: ['@fire/db', 'tailwindcss', 'tailwindcss-animate', 'pg'],
    }
})
