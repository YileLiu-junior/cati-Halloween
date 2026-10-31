export const refundLocked = order => Boolean(order?.primary_refunded || ["pending", "needs_info", "approved", "processing", "refunded"].includes(order?.refund_status));
// 只有批准退款后才收回已生成的头像；审核期间用户仍可查看和保存。
export const imageWithheld = order => Boolean(order?.primary_refunded || ["approved", "processing", "refunded"].includes(order?.refund_status));
export const audit = (env, orderId, action, detail = "") => env.PETI_DB.prepare("INSERT INTO avatar_audit (id,order_id,action,detail,created_at) VALUES (?,?,?,?,?)")
  .bind(crypto.randomUUID(), orderId, action, String(detail).slice(0, 500), Date.now()).run();
export const notify = (env, orderId, event) => env.PETI_DB.prepare("INSERT OR IGNORE INTO avatar_notifications (id,order_id,event) VALUES (?,?,?)")
  .bind(`${orderId}:${event}`, orderId, event).run();
export async function queueGeneration(env, orderId) {
  await env.PETI_DB.prepare("INSERT OR IGNORE INTO delivery_jobs (order_id,updated_at) SELECT id,? FROM orders WHERE id=? AND status='unlocked' AND refund_status IN ('none','rejected')")
    .bind(Date.now(), orderId).run();
  await dispatchGeneration(env, orderId);
}
export async function dispatchGeneration(env, orderId) {
  if (!env.PETI_DELIVERY_QUEUE) return; // 持久任务已保存，队列暂不可用时由定时补投接管。
  const claimed = await env.PETI_DB.prepare("UPDATE delivery_jobs SET state='queued',next_at=?,updated_at=? WHERE order_id=? AND state IN ('pending','queued') AND next_at<=? AND EXISTS (SELECT 1 FROM orders WHERE id=order_id AND status IN ('unlocked','queued') AND refund_status IN ('none','rejected'))")
    .bind(Date.now() + 120_000, Date.now(), orderId, Date.now()).run();
  if (!claimed.meta.changes) return;
  try {
    await env.PETI_DELIVERY_QUEUE.send({ type: "generate", orderId });
    await env.PETI_DB.prepare("UPDATE orders SET status='queued' WHERE id=? AND status='unlocked'").bind(orderId).run();
  } catch {
    await env.PETI_DB.prepare("UPDATE delivery_jobs SET state='pending',next_at=?,error_code='QUEUE_UNAVAILABLE' WHERE order_id=? AND state='queued'")
      .bind(Date.now() + 30_000, orderId).run();
  }
}
