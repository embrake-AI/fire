# Incident IDs vs Identifiers

This document describes when to use **incident ids** and **identifiers**, and the best practices around them.

## Definitions

- **Incident id**: the Durable Object id string (`idFromString` / `idFromName` result). This is the canonical, stable reference to an incident inside the system.
- **Identifier**: a lookup key stored in D1 in the `incident.identifier` JSON array. Identifiers exist to map external context (Slack, dashboard, etc.) back to the incident id.

## Rules of use

1) **Always use the incident id when you have it.**  
   - If you already have an id (e.g. dashboard routes, Slack metadata, D1 lookup), pass it through and use `idFromString`.

2) **Use an identifier only when you do not have the id.**  
   - Identifiers are only a lookup mechanism. They should not replace ids inside the system.

3) **Identifiers are additive and namespaced.**  
   - Store identifiers in D1 as a JSON array of strings.  
   - Use prefixes so identifiers are self‑describing:
     - `slack-channel:<channelId>`
     - `slack-thread:<channelId>-<thread_ts>`

4) **Each adapter owns its own identifiers.**  
   - The dashboard adapter only writes the canonical identifier.  
   - The Slack adapter adds Slack identifiers after it creates/posts in Slack.

5) **Identifier updates must be atomic.**  
   - Use a single SQL update with `json_each` + `UNION` to merge identifiers.  
   - Avoid read‑modify‑write patterns.

## Best practices

- Prefer **id‑first** flows in handlers and senders.
- Treat identifiers as *external routing aids*, not as internal primary keys.
- Keep identifiers immutable and only append new ones.
- Prefix every identifier so it’s obvious which system produced it.

