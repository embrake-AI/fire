# incidentd

`incidentd` is the core runtime responsible for managing live incident state in embrake.

It acts as the source of truth during an incident: tracking status, timeline, participants, signals, and decisions as they happen. All other embrake components read from and write to incidentd.

## What it does

- Maintains the canonical state of active incidents
- Records the incident timeline as an ordered stream of events
- Coordinates updates from humans, automations, and AI
- Exposes a consistent API for querying live incident state
- Persists state transitions for recovery and post-incident analysis

## What it is not

- Not a UI
- Not a notification system
- Not an AI component
- Not an analytics engine
- Not a database

`incidentd` is intentionally boring, stable, and deterministic.

## Why incidentd

Incidents are dynamic, long-running processes.
`incidentd` exists to treat them as such — with clear state transitions, auditable history, and a single authoritative runtime.

In the embrake architecture
```
          ┌────────────┐
          │  Clients   │
          │ (Bot / UI) │
          └─────┬──────┘
                │
        ┌───────▼────────┐
        │   incidentd    │  ← live incident runtime
        └───────┬────────┘
                │
   ┌────────────┼────────────┐
   │            │            │
Signals     Automations      AI
Ingest      & Integrations   Reasoning
```

## Design principles

- Single source of truth
- Append-first timelines
- Explicit state transitions

## Why `incidentd`

incidentd has started as a [Durable Object](https://developers.cloudflare.com/durable-objects/), which run on the [workerd](https://github.com/cloudflare/workerd) platform. Both are a play to how unix names their [daemon](https://en.wikipedia.org/wiki/Daemon_(computing)) services ending with a `d`.
