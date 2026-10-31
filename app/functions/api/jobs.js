import { fail, guarded, isFreeOrder, loadOrder, orderPayload, privateJson, requireGeneration } from "../lib/custom.js";
import { queueGeneration, refundLocked } from "../lib/delivery-store.js";

export const onRequestPost = ({ request, env }) => guarded(async () => {
  const { token, payId } = await request.json();
  const order = await loadOrder(env, payId, token);
  if (isFreeOrder(order)) fail("FREE_ORDER_MANAGED", "免费头像请通过免费生成入口重试", 409);
  if (refundLocked(order)) fail("REFUND_LOCKED", "退款申请处理中，已暂停新的生成", 409);
  if (["queued", "generating", "ready", "uncertain"].includes(order.status)) return privateJson(orderPayload(order));
  if (order.status !== "unlocked" && !(order.status === "failed" && order.retryable && order.attempts < 2)) fail("NOT_UNLOCKED", "订单尚未确认付款，或不能再次生成", 402);
  await requireGeneration(env, JSON.parse(order.result_json));
  if (order.status === "failed") {
    await env.PETI_DB.batch([
      env.PETI_DB.prepare("UPDATE orders SET status='unlocked',retryable=0 WHERE id=? AND status='failed' AND retryable=1 AND refund_status IN ('none','rejected')").bind(order.id),
      env.PETI_DB.prepare("UPDATE delivery_jobs SET state='pending',next_at=0 WHERE order_id=? AND state='failed' AND EXISTS (SELECT 1 FROM orders WHERE id=? AND status='unlocked')").bind(order.id, order.id),
    ]);
  }
  await queueGeneration(env, order.id);
  return privateJson(orderPayload(await loadOrder(env, order.id, token)), 202);
});
