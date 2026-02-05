# incidentd

`incidentd` is the backend runtime for live incident state in Fire.

It is the authoritative runtime during an incident: state transitions are committed in a Durable Object, and side effects are dispatched asynchronously.

## What it does

- Maintains canonical per-incident state
- Records timeline events in order
- Stores internal agent suggestions in the timeline for future turns (without re-dispatching side effects)
- Exposes APIs for Slack and dashboard adapters
- Dispatches asynchronous side effects through workflows
- Persists transitions for recovery and audit

## What it is not

- Not a UI
- Not a standalone analytics system
- Not an LLM model runtime

## Design principles

- Single source of truth (Durable Object)
- Append-first event timeline
- Explicit, durable state transitions
- Side effects isolated from commit path

## Architecture references

- `ARCHITECTURE.md` for data flow and reliability invariants
- `IDENTIFIERS.md` for id-vs-identifier rules
