# @fire/db

Shared database package for Fire.

It contains:

- Drizzle schema definitions
- Drizzle relations
- Generated SQL migrations
- Shared helpers used by services

## Structure

- `src/schema/*`: table/type definitions
- `src/relations.ts`: relation graph
- `migrations/*`: generated migration files
- `drizzle.config.ts`: Drizzle Kit config

## Commands

Run from repo root:

```bash
bun run db:generate   # generate a new migration from schema changes
bun run db:migrate    # apply migrations
bun run build         # build package exports
bun run type-check
```

## Migration Workflow

1. Edit schema files in `src/schema`.
2. Run `bun run db:generate`.
3. Review generated migration files in `migrations/`.
4. Apply with `bun run db:migrate` when appropriate.

Do not hand-write migration folders unless there is a specific, reviewed reason.

## Schema Domains

Current schema exports include:

- auth, api keys
- incident + incident affection
- rotations and overrides
- teams, services, integrations
- status pages
- entry points and ignore rules
