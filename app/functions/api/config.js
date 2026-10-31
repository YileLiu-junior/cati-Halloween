import { amountFen, CUTOFF, generationConfigured, paymentConfigured, privateJson } from "../lib/custom.js";

export async function onRequestGet({ env }) {
  const heartbeat = env.PETI_DB && await env.PETI_DB.prepare("SELECT value,updated_at FROM delivery_control WHERE key='heartbeat'").first();
  return privateJson({
    serverNow: new Date().toISOString(), cutoffAt: new Date(CUTOFF).toISOString(), amountFen: amountFen(),
    testMode: env.PETI_TEST_MODE === "true",
    available: Boolean(env.PETI_DB && env.PETI_IMAGES && generationConfigured(env) && (env.PETI_TEST_MODE === "true" || paymentConfigured(env)) && heartbeat?.value === "ok" && Date.now() - heartbeat.updated_at < 300_000),
  });
}
