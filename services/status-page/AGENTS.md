# status-page Service

Next.js service that serves public status pages as HTML responses.

## Commands

Run from repo root or this directory:

```bash
bun run dev
bun run build
bun run start
bun run type-check
```

Notes:
- Service `lint` script is a placeholder; run checks from monorepo root (`bun run check`).

## Architecture Notes

- Route handlers are the entrypoint; this service does not use traditional `page.tsx` routes.
- Host/domain resolution is part of request handling. Preserve `x-forwarded-host` and normalization behavior when modifying routes.
- `revalidate = 30` is used for incremental freshness. Keep consistency across status/history/feed routes unless there is a clear reason to diverge.

## Key Files

| Path | Purpose |
| --- | --- |
| `src/app/route.ts` | Domain-based status page response |
| `src/app/history/route.ts` | Domain-based incident history response |
| `src/app/[slug]/route.ts` | Slug route + RSS/Atom feed behavior |
| `src/lib/status-pages.server.ts` | DB reads and response data assembly |
| `src/lib/status-pages.render.ts` | HTML rendering |
| `src/lib/status-pages.feed.ts` | RSS/Atom rendering |

## Data Access

- Read data through `src/lib/status-pages.server.ts`.
- Keep route handlers thin: parse request context, fetch data, return renderer output.
- Preserve null/not-found behavior (`404`) and configuration failure behavior (`500` when primary domain is missing).

## Safety Rules

- Do not loosen domain checks in `src/app/[slug]/route.ts` without explicit product/security approval.
- Keep feed URLs and origin derivation consistent with current host/proto logic.
