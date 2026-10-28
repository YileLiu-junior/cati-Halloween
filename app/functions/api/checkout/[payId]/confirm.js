import { amountFen, fail, guarded, loadOrder, orderPayload, paymentConfigured, privateJson } from "../../../lib/custom.js";
import { verifyPayment } from "../../../lib/payment.js";

export const onRequestPost = ({ request, env, params }) => guarded(async () => {
  const { token, platformOrderNo } = await request.json();
  const order = await loadOrder(env, params.payId, token);
  if (order.status !== "unpaid") return privateJson(orderPayload(order));
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
  return privateJson(orderPayload(await loadOrder(env, order.id, token)));
});
