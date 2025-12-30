# AGENTS.md

This repository contains an incident management platform with multiple services.

## Package Management

This monorepo uses **bun** as the package manager and **turbo** for task orchestration. Use `bun` commands instead of npm/pnpm/yarn:

```bash
bun install              # Install dependencies
bun add <package>        # Add a dependency
bun remove <package>     # Remove a dependency

# Development
bun run dev              # Start all dev servers
bun run dev:dashboard    # Start dashboard dev server only
bun run dev:incidentd    # Start incidentd dev server only

# Building
bun run build            # Build all services
bun run build:dashboard  # Build dashboard and its dependencies
bun run build:incidentd  # Build incidentd and its dependencies

# Code Quality
bun run check            # Run both type-check and lint
bun run type-check       # TypeScript type checking only
bun run lint             # Linting only
bun run lint:fix         # Auto-fix linting issues

bun run clean            # Clean all build artifacts and node_modules
```

## Project Structure

| Path                   | Description                                      |
| ---------------------- | ------------------------------------------------ |
| `services/dashboard/`  | SolidJS dashboard (Vite, TanStack Router/Query)  |
| `services/incidentd/`  | Incident management backend (Cloudflare Workers) |

## Code Style

- TypeScript strict mode
- Use existing patterns in codebase as reference
- Follow architecture docs in each service

## Service-Specific Guidelines

See `AGENTS.md` files in each service directory for detailed patterns and conventions.
