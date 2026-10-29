import { createHash } from "node:crypto";
import { amountFen, fail, paymentConfigured } from "./custom.js";

export function afdianSignature(token, params, ts, userId) {
  return createHash("md5").update(`${token}params${params}ts${ts}user_id${userId}`).digest("hex");
}

export function moneyFen(value) {
  if (typeof value !== "string" || !/^\d+\.\d{2}$/.test(value)) return null;
  const [yuan, fen] = value.split(".");
  const result = Number(yuan) * 100 + Number(fen);
  return Number.isSafeInteger(result) ? result : null;
}

export async function verifyPayment(env, order, platformOrderNo) {
  const params = JSON.stringify({ out_trade_no: platformOrderNo });
  const ts = Math.floor(Date.now() / 1000);
  let response;
  try {
    response = await fetch("https://afdian.com/api/open/query-order", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_id: env.AFDIAN_USER_ID, params, ts, sign: afdianSignature(env.AFDIAN_API_TOKEN, params, ts, env.AFDIAN_USER_ID) }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch { fail("PAYMENT_UNAVAILABLE", "暂时无法核对付款，请稍后重试，请勿重复付款", 503, true); }
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ec !== 200 || !Array.isArray(payload.data?.list)) fail("PAYMENT_UNAVAILABLE", "暂时无法核对付款，请稍后重试，请勿重复付款", 503, true);
  const paid = payload.data.list.find((item) => item.out_trade_no === platformOrderNo);
  // user_id 是买家。收款主体由持有创作者凭证的查单接口确认。
  if (!paid || paid.status !== 2 || paid.product_type !== 1 || paid.plan_id !== order.plan_id
    || !Array.isArray(paid.sku_detail) || paid.sku_detail.length !== 1 || paid.sku_detail[0]?.sku_id !== order.sku_id || paid.sku_detail[0].count !== 1
    || moneyFen(paid.total_amount) !== order.amount_fen || paid.remark?.trim() !== order.id) {
    fail("ORDER_MISMATCH", "订单金额、商品型号或留言未匹配，请勿补付，联系作者核对", 409);
  }
  return paid;
}

export async function confirmOrderPayment(env, order, platformOrderNo) {
  if (order.status !== "unpaid") return;
  if (!paymentConfigured(env)) fail("SERVICE_NOT_CONFIGURED", "支付尚未开放", 503);
  if (typeof platformOrderNo !== "string" || !/^\d{10,40}$/.test(platformOrderNo)) fail("PARAM_MISSING", "请填写爱发电订单号");
  if (order.amount_fen !== amountFen()) fail("PAY_ID_STALE", "原报价已过期，请联系作者核对已付订单，请勿重复付款", 409);
  const gate = await env.PETI_DB.prepare("UPDATE payment_gate SET next_check_at = ? WHERE id = 1 AND next_check_at <= ?").bind(Date.now() + 15_000, Date.now()).run();
  if (!gate.meta.changes) fail("RATE_LIMITED", "正在核对订单，请 15 秒后重试", 429, true);
  await verifyPayment(env, order, platformOrderNo);
  try {
    await env.PETI_DB.prepare("UPDATE orders SET status = 'unlocked', platform_order_no = ? WHERE id = ? AND status = 'unpaid'").bind(platformOrderNo, order.id).run();
  } catch (error) {
    if (/UNIQUE constraint failed/i.test(String(error))) fail("ORDER_ALREADY_CLAIMED", "这笔付款已用于另一份定制，请联系作者核对", 409);
    throw error;
  }
}
