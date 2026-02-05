# Fire

Incident management for teams that want clear, durable incident state with low operational overhead.

## Architecture

```text
Slack / Dashboard actions
          |
          v
     services/incidentd
 (Cloudflare Worker + Durable Objects + Workflows)
          |
          +--> services/dashboard   (operator UI)
          +--> services/status-page (public HTML status pages)
          +--> packages/db          (shared Postgres schema)
```

## Services

### `services/incidentd`

Core incident runtime.

- Durable Object is source of truth for incident state/events.
- Outbox + alarms forward events to workflows.
- Workflows dispatch side effects (D1 index updates, Slack/status-page updates, etc.).

### `services/dashboard`

SolidJS operator dashboard.

- Incident and configuration UI.
- Server functions with auth middleware.
- TanStack Router + Query patterns documented in `services/dashboard/AGENTS.md`.

### `services/status-page`

Next.js service that returns public status page HTML.

- Domain-based page resolution.
- Incident history pages and RSS/Atom feeds.
- Reads status-page data from shared DB schema.

### `packages/db`

Shared Drizzle schema package (`@fire/db`) used across services.

## Getting Started

```bash
bun install
bun run dev

# Run services individually
bun run dev:dashboard
bun run dev:incidentd
bun run dev:status-page
```

## Environment

Each service uses its own `.env` file. See service READMEs for required variables.

## License

MIT
