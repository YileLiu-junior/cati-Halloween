import { fail, guarded, privateJson, readJson } from "../../../lib/custom.js";
import { authorizeAdmin } from "../../../lib/avatar-admin.js";
import { bindVerifiedPayment, verifyPayment } from "../../../lib/payment.js";
import { requestRefund, refundPayload } from "../../../lib/refunds.js";
import { audit } from "../../../lib/delivery-store.js";
export const onRequestPost = ({ request, env, params }) => guarded(async () => {
  await authorizeAdmin(env, request);
  const body = await readJson(request);
  const order = await env.PETI_DB.prepare("SELECT * FROM orders WHERE id=?").bind(params.orderId).first();
  if (!order) fail("NOT_FOUND", "订单不存在", 404);
  if (body.action === "confirm_test_payment") {
    if (env.PETI_TEST_MODE !== "true") fail("NOT_FOUND", "没有此操作", 404);
    if (order.status !== "unpaid") return privateJson({ ok: true });
    // 本轮预览只允许一个真实生图订单；管理员和环境开关同时生效。
    const budget = await env.PETI_DB.prepare("INSERT INTO delivery_control (key,value,updated_at) VALUES ('preview_live_order',?,?) ON CONFLICT(key) DO UPDATE SET updated_at=excluded.updated_at WHERE delivery_control.value=excluded.value")
      .bind(order.id, Date.now()).run();
    if (!budget.meta.changes) fail("PREVIEW_LIMIT", "本轮真实生成测试名额已用完", 409);
    await bindVerifiedPayment(env, order, { out_trade_no: String(Date.now()) + order.id.replace(/\D/g, "").slice(0, 10), user_id: "preview-user", status: 2, product_type: 1,
      plan_id: order.plan_id, sku_detail: [{ sku_id: order.sku_id, count: 1 }], total_amount: (order.amount_fen / 100).toFixed(2), custom_order_id: order.id, remark: order.id });
    await audit(env, order.id, "preview_payment_simulated", "No real payment");
    return privateJson({ ok: true, testMode: true });
  }
  if (body.action === "verify_payment") {
    const tradeNo = body.tradeNo || order.platform_order_no;
    if (typeof tradeNo !== "string" || !/^\d{10,40}$/.test(tradeNo)) fail("PARAM_MISSING", "请填写有效的平台订单号");
    await bindVerifiedPayment(env, order, await verifyPayment(env, order, tradeNo));
    await audit(env, order.id, "admin_payment_rechecked");
    return privateJson({ ok: true });
  }
  if (body.action === "request_refund") return privateJson(refundPayload(await requestRefund(env, order, body)));
  if (body.action === "resend_notification") {
    const row = await env.PETI_DB.prepare("SELECT * FROM avatar_notifications WHERE id=? AND order_id=?").bind(body.notificationId || "", order.id).first();
    if (!row || row.state !== "uncertain") fail("NOT_FOUND", "没有待核对的提醒", 404);
    await env.PETI_DB.prepare("UPDATE avatar_notifications SET state='pending',next_at=0 WHERE id=? AND state='uncertain'").bind(row.id).run();
    await audit(env, order.id, "notification_manual_retry", row.event);
    return privateJson({ ok: true });
  }
  fail("PARAM_MISSING", "不支持的操作");
});
