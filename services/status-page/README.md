# status-page

Public status page service built with Next.js.

This service returns pre-rendered HTML responses from route handlers and serves:

- Status page by custom domain
- Incident history page
- RSS/Atom history feeds

## Commands

```bash
bun run dev        # Next dev server on :3001
bun run build
bun run start
bun run type-check
```

Note: service `lint` is a placeholder; lint/check run from monorepo root.

## Route Model

- `src/app/route.ts`: resolve status page by request host domain
- `src/app/history/route.ts`: history page by request host domain
- `src/app/[slug]/route.ts`: slug pages on primary domain + feed endpoints

## Required Environment Variables

- `DATABASE_URL`: Postgres connection string
- `VITE_STATUS_PAGE_DOMAIN`: primary domain used for slug-based routing

## Optional Environment Variables

- `VITE_APP_URL`: used for rendered "powered by" links
- `INTERCOM_CLIENT_SECRET`: validates Intercom canvas request signatures for `/api/intercom/canvas/initialize`
