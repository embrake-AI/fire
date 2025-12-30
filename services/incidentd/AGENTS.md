# incidentd Service

Incident management backend on Cloudflare Workers.

Before making changes to this service, read the architecture documentation in `ARCHITECTURE.md`.

## Package Management

This monorepo uses **bun**. Run commands from the monorepo root or this directory:

```bash
bun run dev        # Start wrangler dev server
bun run deploy     # Deploy to Cloudflare Workers
bun run cf-typegen # Generate Cloudflare types
bun run type-check # TypeScript type checking
bun run lint       # Run biome linter
```

## Key Principles

1. **Data flow follows folder structure**: `receiver → handler → core → dispatcher → sender`
2. **Durable Objects are the source of truth** for incident state (transactional, strongly consistent)
3. **D1 is an eventually consistent index** for queries and listing
4. **Acknowledge on DO persistence**, not on side effects

## Current State vs Target Architecture

The queue-based dispatcher is **bypassed for cost/simplicity**. Currently:

- Handler updates D1 directly after DO response
- Handler invokes senders directly after DO response

When implementing new features, follow the existing pattern but keep code structured for future queue migration.

## File Locations

| Layer      | Path                   | Purpose                                   |
| ---------- | ---------------------- | ----------------------------------------- |
| Receivers  | `adapters/*/receiver/` | Validate, auth, normalize external input  |
| Handler    | `handler/index.ts`     | Orchestrate DO + D1 + senders             |
| Core       | `core/incident.ts`     | Incident Durable Object (source of truth) |
| Dispatcher | `dispatcher/index.ts`  | Queue consumer (not yet implemented)      |
| Senders    | `adapters/*/sender/`   | Send updates to external systems          |

## Adding New Adapters

When adding support for a new external system (e.g., PagerDuty, email):

1. Create `adapters/{name}/receiver/` for incoming webhooks/requests
2. Create `adapters/{name}/sender/` for outgoing notifications
3. Register routes in `src/index.ts`
4. Sender should be invoked by handler (for now) or dispatcher (future)
