import { amountFen, CUTOFF, generationConfigured, paymentConfigured, privateJson } from "../lib/custom.js";

export function onRequestGet({ env }) {
  return privateJson({
    serverNow: new Date().toISOString(), cutoffAt: new Date(CUTOFF).toISOString(), amountFen: amountFen(),
    available: Boolean(env.PETI_DB && env.PETI_IMAGES && generationConfigured(env) && paymentConfigured(env)),
  });
}
