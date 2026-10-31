import { createHash } from "node:crypto";
import { fail, paymentConfigured } from "./custom.js";

export function afdianSignature(token, params, ts, userId) {
  return createHash("md5").update(`${token}params${params}ts${ts}user_id${userId}`).digest("hex");
}

export function moneyFen(value) {
  if (typeof value !== "string" || !/^\d+\.\d{2}$/.test(value)) return null;
  const [yuan, fen] = value.split(".");
  const result = Number(yuan) * 100 + Number(fen);
  return Number.isSafeInteger(result) ? result : null;
}

import { audit, notify, queueGeneration } from "./delivery-store.js";

export async function afdianRequest(env, path, parameters) {
  const params = JSON.stringify(parameters), ts = Math.floor(Date.now() / 1000);
  let response;
  try {
    response = await fetch(`https://afdian.com/api/open/${path}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_id: env.AFDIAN_USER_ID, params, ts,
        sign: afdianSignature(env.AFDIAN_API_TOKEN, params, ts, env.AFDIAN_USER_ID) }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch { fail("PAYMENT_UNAVAILABLE", "暂时无法连接付款平台，请稍后查询，请勿重复付款", 503, true); }
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ec !== 200) fail("PAYMENT_UNAVAILABLE", "付款平台暂未确认操作，请稍后查询", 503, true);
  return payload.data;
}

export function paymentOrderId(paid) {
  const value = paid.custom_order_id?.trim() || paid.remark?.trim();
  return typeof value === "string" && /^[a-f0-9-]{36}$/.test(value) ? value : null;
}

export function assertPaymentMatches(order, paid) {
  if (!paid || paid.status !== 2 || paid.product_type !== 1 || paid.plan_id !== order.plan_id
    || !Array.isArray(paid.sku_detail) || paid.sku_detail.length !== 1
    || paid.sku_detail[0]?.sku_id !== order.sku_id || paid.sku_detail[0].count !== 1
    || moneyFen(paid.total_amount) !== order.amount_fen || paymentOrderId(paid) !== order.id) {
    fail("ORDER_MISMATCH", "付款金额、商品或定制订单未匹配，请联系核对，请勿补付", 409);
  }
}

export async function verifyPayment(env, order, platformOrderNo) {
  const data = await afdianRequest(env, "query-order", { out_trade_no: platformOrderNo });
  if (!Array.isArray(data?.list)) fail("PAYMENT_UNAVAILABLE", "暂时无法核对付款，请稍后重试", 503, true);
  const paid = data.list.find(item => item.out_trade_no === platformOrderNo);
  await recordVerifiedTransaction(env, order, paid);
  assertPaymentMatches(order, paid);
  return paid;
}

async function recordVerifiedTransaction(env, order, paid) {
  if (!paid || paid.status !== 2 || paymentOrderId(paid) !== order.id || moneyFen(paid.total_amount) === null
    || typeof paid.out_trade_no !== "string" || !/^\d{10,40}$/.test(paid.out_trade_no)) return;
  const existing = await env.PETI_DB.prepare("SELECT order_id FROM payment_transactions WHERE trade_no=?").bind(paid.out_trade_no).first();
  if (existing && existing.order_id !== order.id) fail("ORDER_ALREADY_CLAIMED", "这笔付款已关联另一份定制", 409);
  const legacy = await env.PETI_DB.prepare("SELECT id FROM orders WHERE platform_order_no=? AND id!=?").bind(paid.out_trade_no, order.id).first();
  if (legacy) fail("ORDER_ALREADY_CLAIMED", "这笔付款已关联另一份定制", 409);
  let state = "paid";
  try { assertPaymentMatches(order, paid); } catch { state = "mismatch"; }
  await env.PETI_DB.prepare("INSERT OR IGNORE INTO payment_transactions (trade_no,order_id,buyer_id,amount_fen,state,verified_at,custom_order_id) VALUES (?,?,?,?,?,?,?)")
    .bind(paid.out_trade_no, order.id, paid.user_id || null, moneyFen(paid.total_amount), state, Date.now(), paid.custom_order_id || null).run();
}

export async function bindVerifiedPayment(env, order, paid) {
  await recordVerifiedTransaction(env, order, paid);
  assertPaymentMatches(order, paid);
  const claimed = await env.PETI_DB.prepare("SELECT order_id FROM payment_transactions WHERE trade_no=?").bind(paid.out_trade_no).first();
  if (claimed && claimed.order_id !== order.id) fail("ORDER_ALREADY_CLAIMED", "这笔付款已关联另一份定制，请联系核对", 409);
  const now = Date.now();
  try {
    await env.PETI_DB.batch([
      env.PETI_DB.prepare("INSERT OR IGNORE INTO payment_transactions (trade_no,order_id,buyer_id,amount_fen,verified_at,custom_order_id) VALUES (?,?,?,?,?,?)")
        .bind(paid.out_trade_no, order.id, paid.user_id || null, moneyFen(paid.total_amount), now, paid.custom_order_id || null),
      env.PETI_DB.prepare("UPDATE orders SET status='unlocked',platform_order_no=?,paid_at=?,buyer_id=? WHERE id=? AND status='unpaid' AND EXISTS (SELECT 1 FROM payment_transactions WHERE trade_no=? AND order_id=?)")
        .bind(paid.out_trade_no, now, paid.user_id || null, order.id, paid.out_trade_no, order.id),
      env.PETI_DB.prepare("UPDATE orders SET buyer_id=COALESCE(buyer_id,?),paid_at=COALESCE(paid_at,?) WHERE id=? AND platform_order_no=?")
        .bind(paid.user_id || null, now, order.id, paid.out_trade_no),
      env.PETI_DB.prepare("INSERT OR IGNORE INTO delivery_jobs (order_id,updated_at) SELECT id,? FROM orders WHERE id=? AND status='unlocked' AND refund_status IN ('none','rejected')")
        .bind(now, order.id),
      env.PETI_DB.prepare("INSERT OR IGNORE INTO avatar_notifications (id,order_id,event) SELECT ?,id,'paid' FROM orders WHERE id=? AND platform_order_no=?")
        .bind(`${order.id}:paid`, order.id, paid.out_trade_no),
    ]);
  } catch (error) {
    if (/UNIQUE constraint failed/i.test(String(error))) fail("ORDER_ALREADY_CLAIMED", "这笔付款已关联另一份定制，请联系核对", 409);
    throw error;
  }
  const bound = await env.PETI_DB.prepare("SELECT * FROM orders WHERE id=?").bind(order.id).first();
  const transaction = await env.PETI_DB.prepare("SELECT order_id FROM payment_transactions WHERE trade_no=?").bind(paid.out_trade_no).first();
  if (transaction?.order_id !== order.id) fail("ORDER_ALREADY_CLAIMED", "付款关联冲突，请联系核对", 409);
  if (bound.platform_order_no !== paid.out_trade_no) {
    await env.PETI_DB.prepare("UPDATE payment_transactions SET state='duplicate' WHERE trade_no=? AND state='paid'").bind(paid.out_trade_no).run();
    await audit(env, order.id, "duplicate_payment", paid.out_trade_no);
    await notify(env, order.id, "duplicate");
    return;
  }
  await queueGeneration(env, order.id);
}

export async function confirmOrderPayment(env, order, platformOrderNo) {
  if (order.status !== "unpaid") { await queueGeneration(env, order.id); return; }
  if (!paymentConfigured(env)) fail("SERVICE_NOT_CONFIGURED", "支付尚未开放", 503);
  if (typeof platformOrderNo !== "string" || !/^\d{10,40}$/.test(platformOrderNo)) fail("PARAM_MISSING", "请填写爱发电订单号");
  await bindVerifiedPayment(env, order, await verifyPayment(env, order, platformOrderNo));
}

export async function persistPaymentEvent(env, tradeNo) {
  if (typeof tradeNo !== "string" || !/^\d{10,40}$/.test(tradeNo)) return;
  await env.PETI_DB.prepare("INSERT OR IGNORE INTO payment_inbox (trade_no,created_at) VALUES (?,?)").bind(tradeNo, Date.now()).run();
  try { await env.PETI_DELIVERY_QUEUE?.send({ type: "payment", tradeNo }); } catch { /* 通知已入库，定时任务继续处理。 */ }
}

export async function processPaymentEvent(env, tradeNo) {
  const claim = await env.PETI_DB.prepare("UPDATE payment_inbox SET lease_until=?,attempts=attempts+1 WHERE trade_no=? AND state='pending' AND next_at<=? AND lease_until<=?")
    .bind(Date.now() + 60_000, tradeNo, Date.now(), Date.now()).run();
  if (!claim.meta.changes) return;
  try {
    const data = await afdianRequest(env, "query-order", { out_trade_no: tradeNo });
    const paid = data?.list?.find(item => item.out_trade_no === tradeNo);
    const id = paid && paymentOrderId(paid);
    const order = id && await env.PETI_DB.prepare("SELECT * FROM orders WHERE id=?").bind(id).first();
    if (!order) {
      await env.PETI_DB.prepare("UPDATE payment_inbox SET state='unmatched',lease_until=0,error_code='ORDER_UNMATCHED' WHERE trade_no=?").bind(tradeNo).run();
      return;
    }
    await bindVerifiedPayment(env, order, paid);
    await env.PETI_DB.prepare("UPDATE payment_inbox SET state='verified',lease_until=0,error_code=NULL WHERE trade_no=?").bind(tradeNo).run();
  } catch (error) {
    const response = error instanceof Response ? await error.clone().json().catch(() => null) : null;
    const code = response?.code || "PAYMENT_UNAVAILABLE";
    await env.PETI_DB.prepare("UPDATE payment_inbox SET lease_until=0,next_at=?,error_code=?,state=? WHERE trade_no=?")
      .bind(Date.now() + 60_000, code, code === "ORDER_MISMATCH" || code === "ORDER_ALREADY_CLAIMED" ? "mismatch" : "pending", tradeNo).run();
  }
}
