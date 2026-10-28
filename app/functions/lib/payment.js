import { createHash } from "node:crypto";
import { fail } from "./custom.js";

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
  if (!paid || paid.status !== 2 || paid.plan_id !== order.plan_id || moneyFen(paid.total_amount) !== order.amount_fen || paid.remark?.trim() !== order.id) {
    fail("ORDER_MISMATCH", "订单金额、商品或留言未匹配，请勿补付，联系作者核对", 409);
  }
  return paid;
}
