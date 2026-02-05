# AGENTS.md

This repository contains an incident management platform with multiple services.

## Package Management

This monorepo uses **bun** as the package manager and **turbo** for task orchestration.

Run commands from the repo root:

```bash
bun install

# Development
bun run dev
bun run dev:dashboard
bun run dev:incidentd
bun run dev:status-page

# Build and checks
bun run build
bun run check
bun run lint:fix

# Database workflow (@fire/db)
bun run db:generate
bun run db:migrate
```

Notes:
- `bun run dev` regenerates `services/dashboard/src/routeTree.gen.ts`. Do not edit that file manually.
- Service-level `lint` scripts are placeholders; linting runs from root (`bun run check` / `bun run lint:fix`).
- `bun run db:generate` uses Drizzle Kit to generate migrations from `packages/db/src/schema` changes. Do not hand-write migration folders.

## Project Structure

```text
fire/
├── services/
│   ├── dashboard/      # SolidJS SPA (TanStack Start)
│   ├── incidentd/      # Cloudflare Workers backend (DO + Workflows)
│   └── status-page/    # Next.js public status pages (HTML responses)
└── packages/
    ├── common/         # Shared types/utilities
    └── db/             # Drizzle schema, relations, migrations
```

## Code Style

- TypeScript strict mode
- Biome for linting and formatting
- Prefer existing local patterns over inventing new structure

## Service-Specific Guidelines

- `services/dashboard/AGENTS.md`
- `services/incidentd/AGENTS.md`
- `services/status-page/AGENTS.md`
