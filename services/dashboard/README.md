# 🔥 Fire — Incident Management Dashboard

Fire is an incident response dashboard built for teams who believe that **clarity during chaos** is what makes the difference between a 5-minute fix and a 5-hour outage.

## Demo Mode

The dashboard also runs in browser-only demo mode at `demo.firedash.ai`.

- Demo mode uses local browser storage (IndexedDB) instead of backend persistence.
- Feature work should consider demo-mode support as part of implementation.
- If a feature is not supported in demo mode, UI should communicate that explicitly instead of faking successful behavior.

## Philosophy

### Incidents should be visible, not hidden

When something breaks, the worst thing you can do is bury it in noise. Fire surfaces active incidents prominently, with clear visual hierarchy based on status and severity. Critical issues demand attention; resolved ones fade into the background. No hunting through logs, no refreshing dashboards—just a single source of truth.

### The right person at the right time

Incident response isn't about heroics—it's about routing problems to the people best equipped to solve them. Fire integrates with Slack to let you define assignees (individuals or teams) with custom prompts that describe their expertise. This enables intelligent assignment: the database expert gets database issues, the payments team gets payment alerts.

### Slack-first, not Slack-only

Your team lives in Slack. Fire treats Slack as the communication backbone, pulling in users and user groups to build your response roster. But the dashboard remains the command center—a calm, focused interface when Slack threads are moving too fast.

### Configuration is documentation

Who gets paged for what? These decisions shouldn't be tribal knowledge buried in someone's head. Fire makes your incident response process explicit and editable, turning operational decisions into visible configuration that the whole team can understand and improve.

### Less is more during incidents

When you're firefighting at 3 AM, the last thing you need is a cluttered interface with a hundred features. Fire does a few things well: show incidents, show who's handling them, and get out of your way. Every screen is designed for the tired, stressed on-call engineer who needs to understand the situation in seconds.

## Getting Started

```bash
bun install
bun run dev
```

## Stripe Billing Environment

Set these env vars for workspace billing:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_SEAT_PRICE_ID`
- `STRIPE_STARTUP_COUPON_ID`

## Client Provisioning Requirement

Workspace records (`client` table) must set `isStartupEligible` explicitly on creation.
The column is required and has no default in schema, so client provisioning flows must always choose `true` or `false`.

## License

MIT
