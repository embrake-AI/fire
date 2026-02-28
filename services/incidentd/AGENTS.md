# incidentd Service

Incident management backend on Cloudflare Workers.

Before changing runtime behavior, read `ARCHITECTURE.md`.

## Commands

Run from repo root or this service directory:

```bash
bun run dev
bun run deploy
bun run cf-typegen
bun run type-check
```

Notes:
- Service `lint` is a placeholder; lint/check run from repo root (`bun run check`).

## Tests

```bash
bun run test                # all tests (vitest + cloudflare pool workers)
bun run type-check          # tsc --noEmit
```

Eval harness (requires live OpenAI key, not part of `bun run test`):

```bash
OPENAI_API_KEY=... bun services/incidentd/src/agent/eval.similar-incidents.test.ts
OPENAI_API_KEY=... bun services/incidentd/src/agent/eval.similar-incidents.test.ts --section=summarization --runs=3
OPENAI_API_KEY=... bun services/incidentd/src/agent/eval.similar-incidents.test.ts --section=provider-decision --runs=3
OPENAI_API_KEY=... bun services/incidentd/src/agent/eval.similar-incidents.test.ts --out=/tmp/sim-eval.json
```

Eval sections: `all` (default), `provider-decision`, `ranking`, `deep-dive`, `summarization`.

## Core Principles

1. Data flow follows structure: `receiver -> handler -> core -> dispatcher/workflow -> sender`.
2. Durable Object state is source of truth.
3. D1 is a derived/index view.
4. Acknowledge on DO persistence, not side effects.

## File Map

| Layer | Path | Purpose |
| --- | --- | --- |
| Receivers | `src/adapters/*/receiver/` | Auth + normalize external requests |
| Handler | `src/handler/index.ts` | Resolve DO and invoke core operations |
| Core | `src/core/incident.ts` | Transactional incident state + outbox |
| Main Workflow | `src/dispatcher/workflow.ts` | Dispatch event side effects |
| Status Page Dispatch | `src/dispatcher/status-page.ts` | Status-page DB side effects |
| Prompt Workflow | `src/dispatcher/prompt-workflow.ts` | Prompt-triggered workflow logic |
| Agent Turn Workflow | `src/dispatcher/agent-turn-workflow.ts` | Debounced agent turn execution |
| Analysis Workflow | `src/dispatcher/analysis-workflow.ts` | Background/post-resolution analysis |
| Senders | `src/adapters/*/sender/` | Adapter-specific side effects |
| Agent | `src/agent/` | Suggestion generation, Slack block building, agent types |
| AI calls | `src/core/idontknowhowtonamethisitswhereillplacecallstoai.ts` | OpenAI calls (triage, postmortem) |
| Lib | `src/lib/` | DB connection, Slack API wrappers, assertion helpers |

## Handler Example

`startIncident` resolves DO id from identifier and persists through the DO:

```ts
export async function startIncident({ c, m, prompt, createdBy, source, identifier, entryPoints, services }) {
  const clientId = c.var.auth.clientId;
  const metadata = { ...m, clientId, identifier };

  const incidentId = c.env.INCIDENT.idFromName(identifier);
  const incident = c.env.INCIDENT.get(incidentId);

  await incident.start(
    {
      id: incidentId.toString(),
      prompt,
      createdBy,
      source,
      metadata,
    },
    entryPoints,
    services,
  );

  return incidentId.toString();
}
```

## Identifier Rules

Follow `IDENTIFIERS.md`:
- Prefer id-first flows (`idFromString`) when id is already known.
- Use identifiers only for lookup when id is unknown.
- Keep identifier updates additive and atomic.

## Adding a New Adapter

1. Add `src/adapters/{name}/receiver/`.
2. Add `src/adapters/{name}/sender/`.
3. Register receiver routes in `src/index.ts`.
4. Wire sender dispatch in workflow dispatcher.
5. If it introduces new invariants, update `ARCHITECTURE.md`.
