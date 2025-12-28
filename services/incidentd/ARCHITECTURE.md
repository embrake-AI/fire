# Goal

The goal of `incidentd` is to provide **fast acknowledgement** and **strong eventual consistency**.

- Requests are acknowledged when the incident state is durably persisted.
- Side effects (D1 index updates, Slack updates, etc.) are executed asynchronously and retried until they succeed.

## Platform

`incidentd` is deployed to [Cloudflare Workers](https://developers.cloudflare.com/workers/). It uses:

- [Durable Objects](https://developers.cloudflare.com/durable-objects/) as the transactional data plane (per-incident source of truth)
- [D1](https://developers.cloudflare.com/d1/) as the query-optimized control plane index
- [Service Bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/) to call the Worker dispatcher from within the DO without an external queue

> We intentionally do **not** use Cloudflare Queues in the current design. Instead, each Incident DO maintains its own outbox log and uses alarms as a durable retry mechanism. (originally the implementation did, but alarms are superior due to transactional guarantees of DO storage)

## Architecture

The service architecture combines these patterns:

### Control and data plane

Incident state is split across two planes:

- **Data plane (Durable Objects)**
    Each incident is represented by a single Durable Object. The DO is the strongly consistent, transactional source of truth for:

  - the incident event timeline
  - derived incident state (assignee, severity, title, description, status, etc.)

- **Control plane (D1)**
    D1 maintains a query-optimized index of incidents for listing/searching/dashboard views.
    This index is derived from the data plane and is **eventually consistent by design**.

### Outbox pattern (implemented inside the DO)

To ensure reliable downstream processing without an external queue, the DO implements an **internal outbox**:

- The DO persists incident state and (if relevant) appends an event to an `event_log` table.
- Each outbox row has `published_at` which indicates whether the event has been successfully dispatched.
- The DO schedules an alarm to ensure the outbox will be drained

This provides **at-least-once** delivery semantics to downstream processing, with strong transactional consistency between state changes and outbox enqueue.

### Alarm-driven dispatch loop + Service Binding dispatcher

Instead of a separate queue consumer, the DO itself is the driver of eventual consistency:

- The alarm handler drains the outbox in order and calls `incidentd.dispatch(...)` using a Service Binding.
- The dispatcher performs side effects:
  - update the D1 control-plane index
  - invoke adapter senders (Slack, etc.)

This keeps the Durable Object “core” transactional and deterministic, while isolating side effects in a dispatcher entrypoint.

## Reliability invariants

### What we acknowledge

Receivers (Slack, dashboard) are acknowledged when the DO has durably persisted the new state snapshot (no need to wait for the dispatcher)

This guarantees that once the caller is acknowledged, the change is not lost. Side effects are retried until applied, ensuring eventual consistency.

### Outbox invariants (per incident)

- A state update is accepted **iff** it is committed: `state` snapshot + outbox `event_log` row.
- A state update is committed **iff** an alarm is scheduled within `OUTBOX_FLUSH_DELAY_MS` (unless there are no outbox events to dispatch).
- An event is considered dispatched **iff** `published_at` is set on its outbox row.

### Delivery / retries

- Delivery is **at-least-once**: dispatch may be retried.
- Dispatchers and senders should be written to be idempotent (e.g. keyed by `(incident_id, event_id)`).

## Data flow

The folder structure mirrors the data flow through the system:

### Receivers `adapters/*/receiver/`

External systems (Slack, dashboard) interact with the service via adapter-specific receivers. They:

- Authenticate and authorize requests
- Normalize external payloads into internal commands
- Delegate execution to the application handler

Acknowledgement to the external system is tied to DO state persistence, not downstream side effects.

### Handler `handler/index.ts`

The handler is the common entry point for all commands. It:

- Resolves or creates the appropriate Incident Durable Object
- Invokes the relevant core operation on the DO (start, setSeverity, setAssignee, updateStatus, get, etc.)

The handler does not need to synchronously apply side effects. Side effects are guaranteed via the DO outbox + alarm.

### Core `core/incident.ts`

The Incident Durable Object is the transactional core of the system. It:

- Validates and applies incident events
- Derives incident state
- Persists state atomically
- Appends outbox events into `event_log` for downstream processing
- Schedules an alarm to guarantee eventual dispatch

### Dispatcher (Service Binding entrypoint)

The dispatcher is the common exit point for side effects. It is invoked by:

- the DO alarm drain loop (reliable fallback)

Responsibilities:

- Update D1 control-plane index
- Forward events to adapter senders (Slack, future integrations)
- Keep side effects isolated from the transactional core

### Senders `adapters/*/sender/`

Senders translate internal events into external side effects:

- Posting or updating Slack messages
- Pushing updates to the dashboard (the dashboard currently polls)
- Future integrations

Senders are isolated per adapter and are invoked only by the dispatcher.

---

## Sequence diagram (example)

```
                                                               Example: "@fire server down!"
                                                               ─────────────────────────────

┌─────────────────────────────────────────────────────────┐
│                     EXTERNAL SYSTEMS                    │    1. User mentions bot in Slack thread
│                                                         │
│   ┌──────────┐           ...          ┌──────────┐      │
│   │  Slack   │                        │ Dashboard│      │
│   │ (webhook)│                        │ (web app)│      │
│   └────┬─────┘                        └────┬─────┘      │
└────────┼───────────────────────────────────┼────────────┘
         │                                   │
         ▼                                   ▼
┌─────────────────────────────────────────────────────────┐    2. Receiver normalizes + auth
│ RECEIVERS              adapters/*/receiver/routes.ts    │       └─▶ Normalize payload into command
│                                                         │       └─▶ Delegate to handler
│  ┌───────────────────┐        ┌───────────────────┐     │
│  │   slackRoutes     │        │  dashboardRoutes  │     │
│  │ POST /events      │        │ GET /             │     │
│  │ POST /interaction │        │ GET /:id          │     │
│  └─────────┬─────────┘        │ POST /            │     │
│            │                  │ POST /:id/assignee│     │
│            │                  │ POST /:id/severity│     │
│            │                  └─────────┬─────────┘     │
└────────────┼────────────────────────────┼───────────────┘
             │                            │
             │  Normalize, validate, auth │
             ▼                            ▼
┌─────────────────────────────────────────────────────────┐    3. Handler calls DO method
│ HANDLER                           handler/index.ts      │       └─▶ Get/create Incident DO by identifier
│                                                         │       └─▶ Call DO method (start/setSeverity/...)
│  ┌───────────────────────────────────────────────────┐  │
│  │ startIncident() │ listIncidents() │ getIncident() │  │
│  │ updateSeverity()│ updateAssignee()│ updateStatus()│  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  Acknowledge caller on DO persistence                   │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐     4. Incident DO (data plane + outbox)
│ CORE                             core/incident.ts       │
│                                                         │     Transaction (atomic):
│  ┌───────────────────────────────────────────────────┐  │       ├─▶ Persist state snapshot (KV)
│  │              Incident (Durable Object)            │  │       ├─▶ Append outbox event (SQLite event_log)
│  │                                                   │  │       │     - published_at = NULL
│  │  • Transactional source of truth                  │  │       └─▶ Schedule alarm (<= OUTBOX_FLUSH_DELAY_MS)
│  │  • start() │ setSeverity() │ setAssignee() │ get()│  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│                                                         │
│                                                         │
│                                                         │
└──────────────────────────┬──────────────────────────────┘
                           │
                           │  Reliable fallback:
                           │  DO alarm drains outbox until empty
                           ▼
┌─────────────────────────────────────────────────────────┐    5. DO alarm drain loop (internal "queue consumer")
│ ALARM                             core/incident.ts      │       ├─▶ SELECT unpublished events (ORDER BY id)
│ alarm()                                                 │       ├─▶ For each: dispatch via Service Binding
│                                                         │       ├─▶ Mark published_at on success
│                                                         │       └─▶ Reschedule if any remain
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐    6. Dispatcher (Service Binding entrypoint)
│ DISPATCHER                     incidentd.dispatch()     │       ├─▶ Update D1 index (control plane)
│                                                         │       └─▶ Invoke adapter senders (Slack, ...)
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐    7. Senders apply side effects
│ SENDERS                     adapters/*/sender/          │       ├─▶ Slack message update/post
│                                                         │       └─▶ Future integrations
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                     EXTERNAL SYSTEMS                    │
│   ┌──────────┐                        ┌──────────┐      │
│   │  Slack   │                        │ Dashboard│      │
│   └──────────┘                        └──────────┘      │
└─────────────────────────────────────────────────────────┘
```
