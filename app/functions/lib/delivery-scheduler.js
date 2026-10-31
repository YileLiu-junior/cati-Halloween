import { afdianRequest, paymentOrderId, persistPaymentEvent, processPaymentEvent } from "./payment.js";
import { dispatchGeneration, notify } from "./delivery-store.js";
import { recoverStaleGenerations } from "./generation-jobs.js";

export async function reconcilePayments(env) {
  if (env.PETI_TEST_MODE === "true") return;
  const lock = await env.PETI_DB.prepare("INSERT INTO delivery_control (key,value,updated_at) VALUES ('reconcile_lock','',?) ON CONFLICT(key) DO UPDATE SET updated_at=excluded.updated_at WHERE delivery_control.updated_at<?")
    .bind(Date.now(), Date.now() - 45_000).run();
  if (!lock.meta.changes) return;
  const cursor = await env.PETI_DB.prepare("SELECT value FROM delivery_control WHERE key='scan_page'").first();
  const page = Math.max(1, Number(cursor?.value) || 1);
  // 每轮扫最新页，再推进一个历史页，覆盖“早创建、晚付款”。
  for (const currentPage of [...new Set([1, page])]) {
    const data = await afdianRequest(env, "query-order", { page: currentPage, per_page: 100 });
    if (!Array.isArray(data?.list)) throw new Error("Invalid reconciliation response");
    for (const paid of data.list) {
      const id = paymentOrderId(paid);
      if (!id || !await env.PETI_DB.prepare("SELECT id FROM orders WHERE id=?").bind(id).first()) continue;
      await persistPaymentEvent(env, paid.out_trade_no);
    }
    if (currentPage === page) {
      const next = currentPage >= Number(data.total_page || 1) ? 1 : currentPage + 1;
      await env.PETI_DB.prepare("INSERT INTO delivery_control (key,value,updated_at) VALUES ('scan_page',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at")
        .bind(String(next), Date.now()).run();
    }
  }
}

export async function dispatchPending(env) {
  const { results: payments } = await env.PETI_DB.prepare("SELECT trade_no FROM payment_inbox WHERE state='pending' AND next_at<=? AND lease_until<=? LIMIT 10")
    .bind(Date.now(), Date.now()).all();
  for (const row of payments) await processPaymentEvent(env, row.trade_no);
  // 即使在付款与首次投队间中断，也能从已付订单重建任务。
  await env.PETI_DB.prepare("INSERT OR IGNORE INTO delivery_jobs (order_id,updated_at) SELECT id,? FROM orders WHERE status='unlocked' AND refund_status IN ('none','rejected')")
    .bind(Date.now()).run();
  const { results: jobs } = await env.PETI_DB.prepare("SELECT order_id FROM delivery_jobs WHERE state IN ('pending','queued') AND next_at<=? LIMIT 20").bind(Date.now()).all();
  for (const row of jobs) await dispatchGeneration(env, row.order_id);
  const { results: notices } = await env.PETI_DB.prepare("SELECT id FROM avatar_notifications WHERE state='pending' AND next_at<=? ORDER BY CASE event WHEN 'paid' THEN 0 ELSE 1 END LIMIT 8").bind(Date.now()).all();
  for (const row of notices) {
    await env.PETI_DB.prepare("UPDATE avatar_notifications SET next_at=? WHERE id=? AND state='pending'").bind(Date.now() + 120_000, row.id).run();
    try { await env.PETI_DELIVERY_QUEUE?.send({ type: "notify", id: row.id }); } catch { /* 下一轮补投。 */ }
  }
  await env.PETI_DB.prepare("UPDATE avatar_notifications SET state='uncertain',error_code='MESSAGE_INTERRUPTED' WHERE state='sending' AND lease_until<?").bind(Date.now()).run();
}

export async function maintainDelivery(env) {
  await env.PETI_DB.prepare("INSERT INTO delivery_control (key,value,updated_at) VALUES ('heartbeat','ok',?) ON CONFLICT(key) DO UPDATE SET updated_at=excluded.updated_at").bind(Date.now()).run();
  await recoverStaleGenerations(env);
  const { results: delayed } = await env.PETI_DB.prepare("SELECT id FROM orders WHERE platform_order_no IS NOT NULL AND status IN ('unlocked','queued','generating','uncertain') AND paid_at<? AND refund_status IN ('none','rejected') LIMIT 50")
    .bind(Date.now() - 600_000).all();
  for (const order of delayed) await notify(env, order.id, "delayed");
  try { await reconcilePayments(env); } catch { /* 平台暂不可用不阻止已付款任务与其他维护。 */ }
  await dispatchPending(env);
}
