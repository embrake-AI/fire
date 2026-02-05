# Goal

The goal of `incidentd` is fast acknowledgement with durable state, then reliable asynchronous side effects.

- Requests are acknowledged when incident state is durably committed in the Incident Durable Object (DO).
- Side effects run asynchronously through workflows and sender steps.

## Platform

`incidentd` runs on Cloudflare Workers and uses:

- Durable Objects for per-incident transactional state
- D1 for query-oriented incident listing/indexing
- Workflows for asynchronous dispatch and AI/background jobs

We intentionally do **not** use Cloudflare Queues in the current design. The DO outbox + alarms model gives transactional coupling between state commit and event enqueue.

## Runtime Components

### Data Plane: Incident Durable Object

Each incident maps to one DO instance (`INCIDENT`). The DO is the canonical source of truth for:

- event timeline (`event_log`)
- derived incident state (status, severity, assignee, title, description, metadata)

### Control Plane: D1 Index

D1 stores a derived incident index used for list/query views. It is eventually consistent with the DO state.

### Workflows

`incidentd` currently runs four workflow classes:

- `IncidentWorkflow` (`dispatcher/workflow.ts`): per-incident side-effect event loop
- `IncidentPromptWorkflow` (`dispatcher/prompt-workflow.ts`): prompt/agent request handling
- `IncidentAgentTurnWorkflow` (`dispatcher/agent-turn-workflow.ts`): debounced agent turn execution
- `IncidentAnalysisWorkflow` (`dispatcher/analysis-workflow.ts`): post-resolution or background analysis

## Event Pipeline

1. Receiver validates/authenticates and normalizes external input.
2. Handler resolves the target Incident DO (`idFromName` or `idFromString`) and calls core methods.
3. DO transaction commits state + appends `event_log` row + schedules alarm.
4. DO alarm drains unpublished events and forwards to `IncidentWorkflow`.
5. `IncidentWorkflow` dispatches to senders/dispatchers (dashboard, Slack, status-page).

## Reliability Model

### Acknowledgement boundary

Acknowledgement happens after DO persistence, not after side effects.

### Outbox invariants

- A change is accepted iff DO state + outbox row are committed atomically.
- Alarm scheduling is part of the commit path (using `ALARM_INTERVAL_MS` scheduling logic).
- An outbox row is marked forwarded when `published_at` is set.

### Forwarding retries

- DO alarm forwarding retries unpublished events up to `MAX_ATTEMPTS`.
- Forwarding to workflow is at-least-once.

### Dispatcher/sender retries

Each dispatcher call runs inside `IncidentWorkflow` and sender operations execute through workflow `step.do` calls (with retries configured per step where needed).

If a sender still fails, dispatch uses `Promise.allSettled` and logs failure; other senders and later events continue. This isolates side-effect failures from core state durability.

### Idempotency expectation

Senders/dispatchers should be idempotent (for example keyed by `incident_id` + `event_id`) because forwarding is at-least-once.

## Folder-to-Flow Mapping

- Receivers: `src/adapters/*/receiver/`
- Handler: `src/handler/index.ts`
- Core DO: `src/core/incident.ts`
- Workflow dispatch: `src/dispatcher/workflow.ts`
- Side-effect modules: `src/adapters/*/sender/` and `src/dispatcher/status-page.ts`
- Additional workflows: `src/dispatcher/*-workflow.ts`

## Identifier Discipline

Prefer incident DO id when available. Use identifier lookup only when id is unknown. See `IDENTIFIERS.md`.
