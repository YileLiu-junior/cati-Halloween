import { amountFen, CUTOFF, freeGenerationConfigured, privateJson } from "../lib/custom.js";
import { browserKey, freeQuotaSnapshot, isBrowserId } from "../lib/free-quota.js";

// 只接受爱发电官方下单页作为“请作者喝咖啡”入口，原样返回，不附加订单关联参数。
function tipUrl(env) {
  const raw = env.AFDIAN_SUPPORT_URL || env.AFDIAN_PAY_URL;
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (!["afdian.com", "afdian.net"].includes(url.hostname)) return null;
    if (url.pathname !== "/order/create") return null;
    return url.href;
  } catch { return null; }
}

export async function onRequestGet({ request, env }) {
  const query = new URL(request.url).searchParams;
  const heartbeat = env.PETI_DB && await env.PETI_DB.prepare("SELECT value,updated_at FROM delivery_control WHERE key='heartbeat'").first();
  const heartbeatFresh = heartbeat?.value === "ok" && Date.now() - heartbeat.updated_at < 300_000;
  const configured = freeGenerationConfigured(env);
  const browserId = query.get("browserId");
  const key = isBrowserId(browserId) ? await browserKey(browserId) : null;
  const free = await freeQuotaSnapshot(env, key);
  // 维护或未配置优先于额度状态；额度耗尽不影响已生成头像的查看与保存。
  if (!env.PETI_DB || !env.PETI_IMAGES || !configured) free.reason = "SERVICE_NOT_CONFIGURED";
  else if (!heartbeatFresh) free.reason = "DELIVERY_UNAVAILABLE";
  return privateJson({
    serverNow: new Date().toISOString(), cutoffAt: new Date(CUTOFF).toISOString(), amountFen: amountFen(),
    testMode: env.PETI_TEST_MODE === "true",
    available: Boolean(env.PETI_DB && env.PETI_IMAGES && configured && heartbeatFresh),
    tipUrl: tipUrl(env),
    paymentAvailable: env.PAYMENT_ENABLED === "true",
    free,
  });
}
