# AGENTS.md

This repository contains an incident management platform with multiple services.

## Package Management

This monorepo uses **bun** as the package manager and **turbo** for task orchestration. Use `bun` commands instead of npm/pnpm/yarn:

```bash
bun install              # Install dependencies
bun add <package>        # Add a dependency

# Development
bun run dev              # Start all dev servers

# Building
bun run build            # Build all services

# Code Quality
bun run check            # Run both type-check and lint
bun run type-check       # TypeScript type checking only
bun run lint             # Linting only
bun run lint:fix         # Auto-fix linting issues

bun run clean            # Clean all build artifacts and node_modules
```

## Project Structure

```
fire/
├── services/
│   ├── dashboard/          # SolidJS frontend (SPA)
│   └── incidentd/          # Cloudflare Workers backend
├── packages/
│   ├── common/             # Shared types (IS, IS_Event, EntryPoint)
│   └── db/                 # Drizzle ORM schema + migrations
```

| Path                   | Description                                      |
| ---------------------- | ------------------------------------------------ |
| `services/dashboard/`  | SolidJS dashboard (Vite, TanStack Router/Query)  |
| `services/incidentd/`  | Incident management backend (Cloudflare Workers) |
| `packages/common/`     | Shared TypeScript types between services         |
| `packages/db/`         | Drizzle ORM schema, relations, and migrations    |

## Code Patterns

### Dashboard (`services/dashboard/`)

**Stack**: SolidJS, TanStack Start/Router/Query, Tailwind CSS, Ark UI

#### Server Functions with Auth Middleware

All API calls go through server functions with auth middleware. See `src/lib/rotations/rotations.ts`:

```tsx
export const createRotation = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: CreateRotationInput) => data)
  .handler(async ({ data, context }) => {
    // context.clientId, context.userId available from middleware
    const [newRotation] = await db.insert(rotation).values({ ... }).returning();
    return { id: newRotation.id };
  });
```

#### Query Hooks with Optimistic Updates

Mutations use optimistic cache updates with rollback. See `src/lib/rotations/rotations.hooks.ts`:

```tsx
export function useCreateRotation(options?: { onMutate?: (tempId: string) => void }) {
  const queryClient = useQueryClient();
  return useMutation(() => ({
    mutationFn: (data) => createRotationFn({ data }),
    onMutate: async (newData) => {
      const previousData = queryClient.getQueryData(["rotations"]);
      const tempId = `temp-${Date.now()}`;
      queryClient.setQueryData(["rotations"], (old) => [optimisticItem, ...(old ?? [])]);
      options?.onMutate?.(tempId);
      return { previousData, tempId };
    },
    onSuccess: (result, _vars, context) => {
      // Replace temp ID with real ID
      queryClient.setQueryData(["rotations"], (old) =>
        old?.map((r) => (r.id === context?.tempId ? { ...r, id: result.id } : r))
      );
    },
    onError: (_err, _vars, context) => {
      queryClient.setQueryData(["rotations"], context?.previousData);
    },
  }));
}
```

#### Static Shell + Suspense Pattern

Pages render static UI immediately while data-dependent content suspends. See `src/routes/_authed.index.tsx`:

```tsx
function IncidentsList() {
  return (
    <div class="flex-1 bg-background p-6">  {/* Static shell - renders immediately */}
      <Suspense fallback={<ContentSkeleton />}>
        <IncidentsContent />  {/* useQuery happens here - suspends until ready */}
      </Suspense>
    </div>
  );
}
```

#### Config Card Pattern

Expandable config items use consistent components. See `src/components/rotations/RotationCard.tsx`:

```tsx
<ConfigCard isActive={isExpanded()}>
  <ConfigCardRow onClick={toggle}>
    <ConfigCardIcon variant="violet" size="sm"><Icon class="w-4 h-4" /></ConfigCardIcon>
    <ConfigCardTitle>{name}</ConfigCardTitle>
    <span class="flex-1" />
    <ConfigCardActions animated alwaysVisible={isExpanded()}>
      <ConfigCardDeleteButton onDelete={handleDelete} />
    </ConfigCardActions>
    <ChevronDown class="w-4 h-4" />
  </ConfigCardRow>
  <ConfigCardExpandedContent>{/* Expanded form content */}</ConfigCardExpandedContent>
</ConfigCard>
```

### Backend (`services/incidentd/`)

**Stack**: Cloudflare Workers, Hono, Durable Objects, Drizzle ORM

#### Data Flow Architecture

```
receiver → handler → core (DO) → dispatcher → sender
    ↓          ↓          ↓           ↓
 validate   orchestrate  source     D1 + senders
                        of truth
```

Uses outbox pattern: DO commits state + event atomically, alarm processes events via dispatcher.

#### Durable Object as Source of Truth

Incident state lives in Durable Objects for strong consistency. See `src/core/incident.ts`:

```ts
export class Incident extends DurableObject<Env> {
  async start(incident: IS, entryPoint: EntryPoint): Promise<void> {
    // Atomic state + event in single transaction.
    // All storage operations inside the `transaction` form part of the transaction.
    await this.ctx.storage.transaction(async () => {
      this.ctx.storage.kv.put<DOState>(STATE_KEY, state);
			this.ctx.storage.sql.exec("INSERT INTO event_log (event_type, event_data, adapter) VALUES (?, ?, ?)", event.event_type, JSON.stringify(event.event_data), adapter);
			await this.scheduleAlarmAtMost(Date.now()); // calls await this.ctx.storage.setAlarm(..);
			await this.ctx.storage.setAlarm(Date.now()); // Guarantees event processing
			}
    });
  }

  async alarm(): Promise<void> {
    // Process unpublished events with retry logic
  }
}
```

#### Hono Route Handlers

Routes use middleware for auth verification. See `src/adapters/dashboard/receiver/routes.ts`:

```ts
const dashboardRoutes = new Hono<DashboardContext>()
  .use(verifyDashboardRequestMiddleware);

dashboardRoutes.post("/:id/severity", async (c) => {
  const { severity } = await c.req.json<{ severity: IS["severity"] }>();
  const incident = await updateSeverity({ c, id: c.req.param("id"), severity });
  return c.json({ incident });
});
```

#### Handler Orchestration

Handlers coordinate DO, D1, and senders. See `src/handler/index.ts`:

```ts
export async function startIncident({ c, incident, entryPoint }): Promise<string> {
  const id = c.env.INCIDENT.idFromName(incident.id);
  const stub = c.env.INCIDENT.get(id);
  await stub.start(incident, entryPoint);  // DO is source of truth
  // D1 insert happens after DO confirms
  return incident.id;
}
```

### Shared Packages

#### `packages/common/`

Core types shared between services. See `src/index.ts`:

- `IS` - Incident state (id, status, severity, assignee, etc.)
- `IS_Event` - Discriminated union of event types (INCIDENT_CREATED, STATUS_UPDATE, etc.)
- `EntryPoint` - Incident routing configuration

#### `packages/db/`

Drizzle ORM schema and relations. See `src/schema/` for table definitions:

- `incident`, `rotation`, `entryPoint` - Core entities
- `user`, `team`, `teamMember` - User management
- `integration`, `userIntegration` - OAuth connections (Slack, GitHub)

Run migrations from root: `bun run db:migrate`

## Code Style

- TypeScript strict mode
- Biome for linting and formatting
- Use existing patterns in codebase as reference

## Service-Specific Guidelines

See `AGENTS.md` files in each service directory for detailed patterns and conventions:

- `services/dashboard/AGENTS.md` - Suspense patterns, query hooks, config UI components
- `services/incidentd/AGENTS.md` - DO invariants, adapter structure, event processing
