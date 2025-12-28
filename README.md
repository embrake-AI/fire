# 🔥 Fire

**Incident management for teams who value clarity during chaos.**

Fire is a lean incident management system designed around one principle: when things break, the path to resolution should be obvious. No hunting through logs, no context-switching between tools—just a single source of truth that routes problems to the right people.

---

## Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                         Slack                               │
│                    (commands, alerts)                        │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                       incidentd                              │
│              Cloudflare Workers + Durable Objects            │
│                                                              │
│   • Source of truth for live incident state                  │
│   • Stateful incident runtime (per-incident isolation)       │
│   • Slack ↔ Dashboard bridge                                 │
└─────────────────────────┬───────────────────────────────────┘
                          │
          ┌───────────────┴───────────────┐
          ▼                               ▼
┌──────────────────┐           ┌──────────────────┐
│    dashboard     │           │     @fire/db     │
│   SolidJS (SPA)  │           │  Drizzle schema  │
│                  │◄─────────►│                  │
│ • Incident list  │           │ • Assignees      │
│ • Config UI       │           │ • Ignore rules   │
│ • Status updates │           │ • Migrations     │
└──────────────────┘           └──────────────────┘
```

---

## Packages

### `services/incidentd`

The incident runtime. Built on Cloudflare Workers with Durable Objects for per-incident state isolation.

**Philosophy:** Incidents are long-running, stateful processes—not rows in a database. `incidentd` treats each incident as a first-class runtime with its own lifecycle, enabling atomic state transitions and consistent reads without distributed coordination headaches.

**What it does:**

- Maintains canonical state for each active incident
- Handles Slack interactions (commands, button clicks, modals)
- Exposes APIs for the dashboard to read/write incident state
- Persists state transitions for recovery and audit

**What it is not:**

- A UI
- An AI reasoning engine
- A notification dispatcher

`incidentd` is intentionally boring: stable, deterministic, and predictable.

---

### `services/dashboard`

The command center. A SolidJS application built with TanStack Start, configured as a Single Page Application (SPA).

**Philosophy:** When you're firefighting at 3 AM, you need an interface that respects your cognitive load. The dashboard does three things well: show what's broken, show who's handling it, and get out of your way.

**Key screens:**

- **Incident list** — Active incidents prominently displayed with visual hierarchy by severity
- **Incident detail** — Full context, timeline, and actions for a single incident
- **Configuration** — Manage assignees, escalation paths, and routing rules

**Design principles:**

- Slack-first roster (pulls users/groups from your workspace)
- Configuration as documentation (no tribal knowledge)
- Less is more (minimal UI for stressed engineers)

---

### `packages/db`

Shared database schema using Drizzle ORM. Published as `@fire/db` for use across services.

**Contains:**

- `assignee` — Slack users/groups that can be assigned to incidents, with natural language prompts describing their expertise

---

## Getting Started

```bash
# Install dependencies
bun install

# Run all services in development
bun run dev

# Or run individually
bun run dev:dashboard   # Dashboard on :3000
bun run dev:incidentd   # Worker with wrangler
```

### Environment Variables

Each service needs its own `.env` file. See the respective service READMEs for details.

---

## Philosophy

### Incidents should be visible, not hidden

When something breaks, the worst response is burying it in noise. Fire surfaces active incidents prominently—critical issues demand attention, resolved ones fade to the background.

### The right person at the right time

Incident response is about routing, not heroics. Fire lets you define assignees with prompts describing their expertise ("database issues", "payment processing"), enabling intelligent assignment.

### Configuration is documentation

Who gets paged for what? What's the escalation path? These shouldn't be tribal knowledge. Fire makes your incident response process explicit and editable.

### Slack-first, not Slack-only

Your team lives in Slack. Fire treats it as the communication backbone while the dashboard remains the calm command center when threads move too fast.

---

## License

MIT
