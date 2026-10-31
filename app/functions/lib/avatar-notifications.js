import { afdianRequest } from "./payment.js";
import { avatarOrderUrl } from "./order-access.js";

const messages = {
  paid: "已收到头像定制付款，正在后台生成。查看进度、领取头像或申请售后：",
  ready: "你的宠物万圣节头像已生成！请在7天内保存。领取头像：",
  failed: "头像生成暂未完成，付款记录已保留。查看状态或申请退款：",
  delayed: "头像生成已超时，我们已记录异常。你可以在订单页申请全额退款：",
  duplicate: "检测到这份头像定制有重复付款，请通过订单页申请核对多付金额：",
  refund_pending: "已收到你的退款申请，新的生成与重试已暂停。审核期间已生成的头像仍可保存。查看审核进度：",
  refund_needs_info: "退款申请需要补充信息，请在订单页查看并补充说明：",
  refund_approved: "你的退款申请已通过审核，资金退回仍需渠道处理。查看进度：",
  refund_processing: "退款申请正在退款渠道处理中，请留意到账情况。查看进度：",
  refund_refunded: "这笔退款已完成，处理凭证已记录。查看退款状态：",
  refund_rejected: "退款申请已完成审核，具体原因和复核入口见订单页：",
};

export async function sendAvatarNotification(env, id) {
  const row = await env.PETI_DB.prepare("SELECT * FROM avatar_notifications WHERE id=?").bind(id).first();
  if (!row || row.state !== "pending" || row.next_at > Date.now()) return;
  const event = row.event.split(":")[0];
  const order = await env.PETI_DB.prepare("SELECT * FROM orders WHERE id=?").bind(row.order_id).first();
  if (!order?.buyer_id) return;
  const requestId = row.event.split(":")[1];
  if (event.startsWith("refund_") && requestId) {
    const refund = await env.PETI_DB.prepare("SELECT state FROM refund_requests WHERE id=? AND order_id=?").bind(requestId, row.order_id).first();
    if (!refund || refund.state !== event.slice(7)) {
      await env.PETI_DB.prepare("UPDATE avatar_notifications SET state='superseded' WHERE id=? AND state='pending'").bind(id).run(); return;
    }
  }
  // 过期的“正在生成”提醒不覆盖已退款、已交付或已失败的事实。
  if ((event === "paid" && order.status !== "queued" && order.status !== "unlocked" && order.status !== "generating")
    || (event === "ready" && order.status !== "ready")
    || (event === "failed" && !["failed", "uncertain"].includes(order.status))
    || (event === "delayed" && !["unlocked", "queued", "generating", "uncertain"].includes(order.status))
    || (["paid", "ready", "failed", "delayed"].includes(event) && (order.primary_refunded || ["pending", "needs_info", "approved", "processing", "refunded"].includes(order.refund_status)))) {
    await env.PETI_DB.prepare("UPDATE avatar_notifications SET state='superseded' WHERE id=? AND state='pending'").bind(id).run();
    return;
  }
  const content = `${messages[event] || "你的头像订单状态已更新："}\n${await avatarOrderUrl(env, order)}`;
  const claimed = await env.PETI_DB.prepare("UPDATE avatar_notifications SET state='sending',attempts=attempts+1,lease_until=? WHERE id=? AND state='pending'")
    .bind(Date.now() + 60_000, id).run();
  if (!claimed.meta.changes) return;
  if (env.PETI_TEST_MODE === "true") {
    // 云端预览只记录测试通知；绝不向真实爱发电用户发送。
    await env.PETI_DB.batch([
      env.PETI_DB.prepare("INSERT INTO delivery_control (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at")
        .bind(`test_notice:${id}`, JSON.stringify({ recipient: order.buyer_id, content }), Date.now()),
      env.PETI_DB.prepare("UPDATE avatar_notifications SET state='test_captured',lease_until=0,sent_at=? WHERE id=? AND state='sending'").bind(Date.now(), id),
    ]);
    return;
  }
  try {
    await afdianRequest(env, "send-msg", { recipient: order.buyer_id, content });
    await env.PETI_DB.prepare("UPDATE avatar_notifications SET state='sent',lease_until=0,sent_at=?,error_code=NULL WHERE id=?").bind(Date.now(), id).run();
  } catch {
    // 私信接口没有公开幂等键；结果未知时保留核对项，避免自动重复私信。
    await env.PETI_DB.prepare("UPDATE avatar_notifications SET state='uncertain',lease_until=0,error_code='MESSAGE_RESULT_UNKNOWN' WHERE id=?").bind(id).run();
  }
}
