import { processPaymentEvent } from "./functions/lib/payment.js";
import { processGeneration } from "./functions/lib/generation-jobs.js";
import { sendAvatarNotification } from "./functions/lib/avatar-notifications.js";
import { maintainDelivery, dispatchPending } from "./functions/lib/delivery-scheduler.js";

export default {
  async queue(batch, env) {
    if (env.DELIVERY_ENABLED !== "true") { for (const message of batch.messages) message.retry({ delaySeconds: 60 }); return; }
    for (const message of batch.messages) {
      try {
        const data = message.body;
        if (data?.type === "payment") await processPaymentEvent(env, data.tradeNo);
        else if (data?.type === "generate") await processGeneration(env, data.orderId);
        else if (data?.type === "notify") {
          await env.PETI_DB.prepare("UPDATE avatar_notifications SET next_at=0 WHERE id=? AND state='pending'").bind(data.id).run();
          await sendAvatarNotification(env, data.id);
        }
        message.ack();
      } catch (error) {
        console.error(JSON.stringify({ event: "delivery_handler_failed", type: message.body?.type, error: error.name || "Error" }));
        message.retry({ delaySeconds: 60 });
      }
    }
    await dispatchPending(env);
  },
  async scheduled(_event, env) {
    if (env.DELIVERY_ENABLED !== "true") {
      await env.PETI_DB.prepare("INSERT INTO delivery_control (key,value,updated_at) VALUES ('heartbeat','paused',?) ON CONFLICT(key) DO UPDATE SET value='paused',updated_at=excluded.updated_at").bind(Date.now()).run();
      return;
    }
    await maintainDelivery(env);
  },
  async fetch() { return new Response("PETI avatar delivery worker", { status: 404 }); },
};
