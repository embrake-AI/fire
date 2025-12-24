import { Hono } from "hono";
import { dashboardRoutes } from "./adapters/dashboard/receiver/routes";
import { slackRoutes } from "./adapters/slack/receiver/routes";

export { Incident } from "./core/incident";

const app = new Hono<{ Bindings: Env }>();

app.route("/slack", slackRoutes);
app.route("/dashboard", dashboardRoutes);

export default {
	fetch: app.fetch,
	// queue: TODO:
};

// export default {
//     async queue(batch: MessageBatch<IncidentEventMessageV1>, env: Env, ctx: ExecutionContext) {
//       for (const msg of batch.messages) {

//       possible improvement: apply all to D1 at once

//         try {
//           const e = msg.body;
//           // 1) Apply to D1 index idempotently:
//           //    UPDATE/UPSERT only if event not already applied
//           await applyToD1(env.DB, e);

//           // 2) Send side effects idempotently: (or duplicate and make senders idempotent)
//           //    (store last_sent_event_id per integration target)
//           await dispatchToSenders(env, e);

//           msg.ack(); // marks delivered regardless of handler outcome :contentReference[oaicite:28]{index=28}
//         } catch (err) {
//           // Transient? retry with delay; otherwise also retry until DLQ catches it.
//           // msg.attempts starts at 1. :contentReference[oaicite:29]{index=29}
//           const delaySeconds = computeDelaySeconds(msg.attempts);
//           msg.retry({ delaySeconds }); // marks for retry :contentReference[oaicite:30]{index=30}
//           // (Optional) log err + msg.id + incident_id/event_id
//         }
//       }
//     },
//   };
