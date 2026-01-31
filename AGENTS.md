# AGENTS.md

This repository contains an incident management platform with multiple services.

## Package Management

This monorepo uses **bun** as the package manager and **turbo** for task orchestration. Use `bun` commands instead of npm/pnpm/yarn:

```bash
bun install              # Install dependencies
bun add <package>        # Add a dependency

# Development
bun run dev              # Start all dev servers - RUN IT TO UPDATE `routeTree.gen.ts`, do not edit manually

# Building
bun run build            # Build all services. - RUN TO UPDATE TYPES, for example when modifying packages/*

# Code Quality
bun run check            # Run both type-check and lint - RUN IT ALWAYS BEFORE COMMITTING
bun run lint:fix         # Auto-fix linting issues

bun run clean            # Clean all build artifacts and node_modules

# db (/packages.db)
bun run db:generate      # Generate Prisma schema from Drizzle schema - - RUN TO GENERATE MIGRATIONS, do not generate manually
```

## Project Structure

```
fire/
├── services/
│   ├── dashboard/          # SolidJS frontend (SPA)
│   ├── status-page/        # NextJS (server returns HTML)
│   └── incidentd/          # Cloudflare Workers backend
├── packages/
│   ├── common/             # Shared types (IS, IS_Event, EntryPoint)
│   └── db/                 # Drizzle ORM schema + migrations
```

| Path                   | Description                                      |
| ---------------------- | ------------------------------------------------ |
| `services/dashboard/`  | SolidJS dashboard (Vite, TanStack Router/Query)  |
| `services/status-page/`| public status pages (server returns HTML)         |
| `services/incidentd/`  | Incident management backend (Cloudflare Workers) |
| `packages/common/`     | Shared TypeScript types between services         |
| `packages/db/`         | Drizzle ORM schema, relations, and migrations    |

## Code Style

- TypeScript strict mode
- Biome for linting and formatting
- Use existing patterns in codebase as reference

## Service-Specific Guidelines

See `AGENTS.md` files in each service directory for detailed patterns and conventions:

- `services/dashboard/AGENTS.md` - Suspense patterns, query hooks, config UI components
- `services/incidentd/AGENTS.md` - DO invariants, adapter structure, event processing
