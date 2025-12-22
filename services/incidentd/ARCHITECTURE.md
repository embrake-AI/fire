# Goal

The goal of `incidentd` is to provide fast acknowledgement and strong eventual consistency.

## Platform

`incidentd` is deployed to [Cloudflare Workers](https://developers.cloudflare.com/workers/). It uses:

-   [D1](https://developers.cloudflare.com/d1/) to maintain an index of incidents
-   [Durable Objects](https://developers.cloudflare.com/durable-objects/) to maintain fast strong transactional state for events
-   [Queues](https://developers.cloudflare.com/queues/) to ensure eventual consistency from the DOs to the D1 index (not yet, for now this is not guaranteed)

## Architecture

The service architecture is a combination of 2 patterns:

[**Control and data plane**](https://developers.cloudflare.com/reference-architecture/diagrams/storage/durable-object-control-data-plane-pattern/)
Incident state is split across two planes

-   _Data plane (Durable Objects)_
    Each incident is represented by a single Durable Object, which is the strongly consistent, transactional source of truth for the incident’s event timeline and derived state (assignee, severity, title, etc...).
-   _Control plane (D1)_
    D1 maintains an query-optimized index of incidents for listing, searching and dashboard views. This index is derived from the data plane and is eventually consistent by design.

[**Outbox pattern** (Planned)](https://developers.cloudflare.com/queues/examples/use-queues-with-durable-objects/)
To ensure reliable, atomic message delivery, the architecture follows the outbox pattern:

-   Durable objects persist incident state atomically and (if relevant) enqueue an event describing the change
-   A Queue consumer processes these events asynchronously to: - update the D1 index - notify external systems (ex. Slack)

> **Current state**: for cost and simplicity, the queue consumer is bypassed. The handler updates D1 and invokes senders after DO response

## Data Flow

The folder structure mirrors the data flow through the system:

### Receivers `adapters/*/receiver/`

External systems (Slack, dashboard) interact with the service via adapter-specific receivers. They:

-   Authenticate and authorize requests
-   Normalize external payloads into internal commands
-   Delegate execution to the application handler

Acknowledgement to the external system is tied to DO state persistence, not downstream side effects.

### Handler `handler/index.ts`

The handler is the common entry point for all commands. It:

-   Resolves or creates the appropriate Incident Durable Object
-   Invokes the relevant core operation
-   (for now) Updates D1 index and invokes dispatchers

### Core `core/incident.ts`

The Incident Durable Object is the transactional core of the system. It:

-   Validates and applies incident events
-   Derives incident state deterministically
-   Persists state atomically
-   (not yet) Emits events for downstream consumers

### Dispatcher `dispatcher/index.ts`

The dispatcher is the common exit point. In the target architecture (not yet), it:

-   Consumes incident events from the queue
-   Updates the D1 control-plane index
-   Forwards events to adapter senders

This layer ensures eventual consistency between the core and external systems.

### Senders `adapters/*/sender/`

Senders translate internal events into external side effects:

-   Posting or updating Slack messages
-   Pushing updates to the dashboard (not really as for now the dashboard polls)
-   Invoking future integrations

Senders are isolated per adapter and are invoked only by the dispatcher.

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
┌─────────────────────────────────────────────────────────┐    2. POST /events receives webhook
│ RECEIVERS              adapters/*/receiver/routes.ts    │       └─▶ Extract team_id, user, prompt
│                                                         │       └─▶ Look up integration credentials
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
┌─────────────────────────────────────────────────────────┐    3. startIncident()
│ HANDLER                           handler/index.ts      │       └─▶ Get/create Incident DO by identifier
│                                                         │       └─▶ Call incident.start() on the DO
│  ┌───────────────────────────────────────────────────┐  │
│  │ startIncident() │ listIncidents() │ getIncident() │  │
│  │ updateseverity()│ updateAssignee()                │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  Orchestrates: calls Core (DO) + updates D1 index       │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐     4. Incident DO
│ CORE                             core/incident.ts       │       └─▶ Calculate assignee, severity, title
│                                                         │       └─▶ Store state atomically in DO storage
│  ┌───────────────────────────────────────────────────┐  │       └─▶ Publish event to Queue (future)
│  │              Incident (Durable Object)            │  │       └─▶ Return incident data
│  │                                                   │  │
│  │  • Transactional source of truth                  │  │
│  │  • start() │ setseverity() │ setAssignee() │ get()│  │
│  └───────────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────────┘
                           │
    On relevant event (creation, severity/assignee change...)
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐    5. Queue consumer (bypassed currently)
│ DISPATCHER                       dispatcher/index.ts    │       └─▶ Consume queue messages
│                                                         │       └─▶ Write to D1 (done in handler now)
│  ┌───────────────────────────────────────────────────┐  │       └─▶ Invoke senders (done in handler now)
│  │ Queue consumer (TODO: bypassed for cost)          │  │
│  │ Ensures eventual consistency DO → external systems│  │
│  └───────────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐    6. slackSender
│ SENDERS                     adapters/*/sender/ (TODO)   │       └─▶ Post message back to Slack thread
│                                                         │       └─▶ Include incident card with controls
│  ┌───────────────────┐                                  │
│  │   slackSender     │             ...                  │
│  │ replyToSlack()    │                                  │
│  │ updateMessage()   │                                  │
│  └─────────┬─────────┘                                  │
└────────────┼────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────┐
│                     EXTERNAL SYSTEMS                    │
│   ┌──────────┐                        ┌──────────┐      │
│   │  Slack   │                        │ Dashboard│      │
│   └──────────┘                        └──────────┘      │
└─────────────────────────────────────────────────────────┘
```
