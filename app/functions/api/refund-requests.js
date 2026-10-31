import { fail, guarded, isFreeOrder, loadOrder, privateJson, readJson } from "../lib/custom.js";
import { rateLimit, clientIp } from "../lib/api.js";
import { refundPayload, requestRefund, withdrawRefund } from "../lib/refunds.js";
export const onRequestPost = ({ request, env }) => guarded(async () => {
  if (!rateLimit(`refund:${clientIp(request)}`, 30)) fail("RATE_LIMITED", "提交过于频繁，请稍后再试", 429);
  const body = await readJson(request);
  const order = await loadOrder(env, body.payId, body.token);
  if (isFreeOrder(order)) fail("NOT_REFUNDABLE", "免费生成不涉及退款", 409);
  if (body.action === "withdraw") return privateJson(refundPayload(await withdrawRefund(env, order)));
  return privateJson(refundPayload(await requestRefund(env, order, body)), 201);
});
export const onRequestGet = ({ request, env }) => guarded(async () => {
  const order = await loadOrder(env, new URL(request.url).searchParams.get("payId"), request.headers.get("X-PT-Token"));
  if (isFreeOrder(order)) fail("NOT_REFUNDABLE", "免费生成不涉及退款", 409);
  const row = await env.PETI_DB.prepare("SELECT * FROM refund_requests WHERE order_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1").bind(order.id).first();
  return privateJson({ request: refundPayload(row) });
});
