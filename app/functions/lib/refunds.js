import { fail } from "./custom.js";
import { audit, dispatchGeneration } from "./delivery-store.js";
import { finishStoredImage } from "./generation-jobs.js";

const reasons = new Set(["not_delivered", "generation_failed", "duplicate_payment", "image_quality", "payment_unconfirmed"]);
// 这两种原因本来就发生在订单绑定主交易之前，不要求已确认付款。
const prePaymentReasons = new Set(["payment_unconfirmed", "duplicate_payment"]);
// 首次申请 + 一次复核；重复付款单独核对，不受次数限制。撤回和驳回都计入次数，避免反复重开。
const MAX_REQUESTS = 2;
const ACTIVE = "('pending','needs_info','approved','processing')";
const clean = (text, limit) => typeof text === "string" ? text.trim().slice(0, limit) : "";
export async function requestRefund(env, order, body) {
  if (!reasons.has(body.reason)) fail("PARAM_MISSING", "请选择申请原因");
  if ((order.primary_refunded || order.refund_status === "refunded") && body.reason !== "duplicate_payment") fail("ALREADY_REFUNDED", "本单原付款已退款；其他付款可选择重复付款核对", 409);
  const existing = await env.PETI_DB.prepare(`SELECT * FROM refund_requests WHERE order_id=? AND state IN ${ACTIVE}`).bind(order.id).first();
  if (existing) {
    if (existing.state === "needs_info") {
      await env.PETI_DB.batch([
        env.PETI_DB.prepare("UPDATE refund_requests SET details=?,contact=?,state='pending' WHERE id=? AND state='needs_info'").bind(clean(body.details, 500), clean(body.contact, 120), existing.id),
        env.PETI_DB.prepare("UPDATE orders SET refund_status='pending' WHERE id=? AND refund_status='needs_info'").bind(order.id),
      ]);
    }
    return await env.PETI_DB.prepare("SELECT * FROM refund_requests WHERE id=?").bind(existing.id).first();
  }
  // 未确认付款的订单不能冻结交付：用户可能先申请再付款，导致付了钱却一直不生成。
  if (!prePaymentReasons.has(body.reason) && !order.paid_at && !order.platform_order_no) fail("PAYMENT_REQUIRED", "这笔订单还没有确认付款。如已付款但未被识别，请选择「已付款，仍未识别」", 409);
  if (body.reason !== "duplicate_payment") {
    const previous = await env.PETI_DB.prepare("SELECT count(*) AS n FROM refund_requests WHERE order_id=? AND reason!='duplicate_payment'").bind(order.id).first();
    if (previous.n >= MAX_REQUESTS) fail("REFUND_LIMIT", `该订单的售后申请已达 ${MAX_REQUESTS} 次上限，如仍有问题请通过爱发电私信联系作者`, 409);
  }
  const id = crypto.randomUUID();
  try {
    await env.PETI_DB.batch([
      env.PETI_DB.prepare("INSERT INTO refund_requests (id,order_id,reason,details,contact,amount_fen,created_at) VALUES (?,?,?,?,?,?,?)")
        .bind(id, order.id, body.reason, clean(body.details, 500), clean(body.contact, 120), order.amount_fen, Date.now()),
      env.PETI_DB.prepare("UPDATE orders SET refund_status='pending' WHERE id=?").bind(order.id),
      env.PETI_DB.prepare("UPDATE delivery_jobs SET state='blocked' WHERE order_id=? AND state IN ('pending','queued','failed')").bind(order.id),
      env.PETI_DB.prepare("INSERT OR IGNORE INTO avatar_notifications (id,order_id,event) VALUES (?,?,?)").bind(`${order.id}:refund_pending:${id}`, order.id, `refund_pending:${id}`),
    ]);
  } catch (error) {
    if (!/UNIQUE constraint failed/i.test(String(error))) throw error;
    const active = await env.PETI_DB.prepare(`SELECT * FROM refund_requests WHERE order_id=? AND state IN ${ACTIVE}`).bind(order.id).first();
    if (active) return active;
    throw error;
  }
  await audit(env, order.id, "refund_requested", body.reason);
  return env.PETI_DB.prepare("SELECT * FROM refund_requests WHERE id=?").bind(id).first();
}

// 只有尚未出结论的申请可以撤回；已批准的申请必须由审核继续走完。
export async function withdrawRefund(env, order) {
  if (order.primary_refunded) fail("ALREADY_REFUNDED", "原付款已退款，不能撤回申请", 409);
  const request = await env.PETI_DB.prepare("SELECT * FROM refund_requests WHERE order_id=? AND state IN ('pending','needs_info') ORDER BY created_at DESC,rowid DESC LIMIT 1").bind(order.id).first();
  if (!request) fail("REFUND_STATE", "当前没有可撤回的申请，请刷新后核对", 409);
  const reviewId = crypto.randomUUID(), now = Date.now();
  const changed = await env.PETI_DB.batch([
    env.PETI_DB.prepare("UPDATE refund_requests SET state='withdrawn',reviewed_at=?,review_id=? WHERE id=? AND state IN ('pending','needs_info')")
      .bind(now, reviewId, request.id),
    env.PETI_DB.prepare("UPDATE orders SET refund_status='none' WHERE id=? AND refund_status IN ('pending','needs_info') AND primary_refunded=0 AND EXISTS (SELECT 1 FROM refund_requests WHERE id=? AND state='withdrawn' AND review_id=?)")
      .bind(order.id, request.id, reviewId),
  ]);
  if (!changed[0].meta.changes) fail("REFUND_STATE", "申请状态已变化，请刷新后核对", 409);
  await audit(env, order.id, "refund_withdrawn", request.reason);
  await resumeDelivery(env, order.id);
  return env.PETI_DB.prepare("SELECT * FROM refund_requests WHERE id=?").bind(request.id).first();
}

// 撤回后恢复被申请暂停的交付：优先交付已生成但被拦下的成品，避免重复调用模型。
async function resumeDelivery(env, orderId) {
  const job = await env.PETI_DB.prepare("SELECT * FROM delivery_jobs WHERE order_id=?").bind(orderId).first();
  const attempt = job?.attempt_id && await env.PETI_DB.prepare("SELECT * FROM generation_attempts WHERE id=?").bind(job.attempt_id).first();
  if (attempt?.state === "ready" && attempt.image_key && await env.PETI_IMAGES.head(attempt.image_key)) {
    await finishStoredImage(env, orderId, attempt.id, attempt.image_key);
    return;
  }
  // 生成失败的任务不自动重跑，避免撤回后再次消耗收费调用；用户可自行点击重试。
  await env.PETI_DB.prepare("INSERT OR IGNORE INTO delivery_jobs (order_id,updated_at) SELECT id,? FROM orders WHERE id=? AND status IN ('unlocked','queued','generating') AND primary_refunded=0 AND refund_status IN ('none','rejected')")
    .bind(Date.now(), orderId).run();
  await env.PETI_DB.batch([
    env.PETI_DB.prepare("UPDATE delivery_jobs SET state='pending',next_at=0,lease_until=0,updated_at=? WHERE order_id=? AND state='blocked' AND EXISTS (SELECT 1 FROM orders WHERE id=? AND status IN ('unlocked','queued','generating') AND primary_refunded=0 AND refund_status IN ('none','rejected'))")
      .bind(Date.now(), orderId, orderId),
    env.PETI_DB.prepare("UPDATE orders SET status='unlocked',attempts=MAX(0,attempts-?) WHERE id=? AND status='generating' AND primary_refunded=0 AND refund_status IN ('none','rejected') AND EXISTS (SELECT 1 FROM delivery_jobs WHERE order_id=? AND state='pending')")
      .bind(attempt ? 1 : 0, orderId, orderId),
  ]);
  const resumed = await env.PETI_DB.prepare("SELECT state FROM delivery_jobs WHERE order_id=?").bind(orderId).first();
  if (resumed?.state === "pending") await dispatchGeneration(env, orderId);
}

export function refundPayload(row) {
  return row ? { requestId: row.id, reason: row.reason, status: row.state, amountFen: row.amount_fen,
    submittedAt: row.created_at, reviewedAt: row.reviewed_at, note: row.review_note || "",
    channel: row.channel, proofReference: row.state === "refunded" ? row.proof_reference : null } : null;
}

export async function reviewRefund(env, id, body) {
  const request = await env.PETI_DB.prepare("SELECT * FROM refund_requests WHERE id=?").bind(id).first();
  if (!request) fail("NOT_FOUND", "没有找到退款申请", 404);
  const order = await env.PETI_DB.prepare("SELECT * FROM orders WHERE id=?").bind(request.order_id).first();
  const note = clean(body.note, 500), action = body.action;
  if (!["approve", "reject", "needs_info", "processing", "refunded"].includes(action)) fail("PARAM_MISSING", "请选择审核操作");
  if (["refunded", "rejected", "withdrawn"].includes(request.state)) fail("REFUND_FINAL", "该申请已结束或已由用户撤回，请勿重复操作", 409);
  let next = { approve: "approved", reject: "rejected", needs_info: "needs_info", processing: "processing", refunded: "refunded" }[action];
  let tradeNo = request.trade_no || order.platform_order_no;
  if (!tradeNo && request.reason !== "duplicate_payment") tradeNo = (await env.PETI_DB.prepare("SELECT trade_no FROM payment_transactions WHERE order_id=? AND state IN ('paid','mismatch') ORDER BY verified_at LIMIT 1").bind(order.id).first())?.trade_no;
  if (request.reason === "duplicate_payment" && !request.trade_no) {
    tradeNo = (await env.PETI_DB.prepare("SELECT trade_no FROM payment_transactions WHERE order_id=? AND state='duplicate' ORDER BY verified_at LIMIT 1").bind(order.id).first())?.trade_no;
  }
  const transaction = tradeNo && await env.PETI_DB.prepare("SELECT * FROM payment_transactions WHERE trade_no=? AND order_id=?").bind(tradeNo, order.id).first();
  if (["approve", "processing", "refunded"].includes(action) && (!transaction || transaction.state === "refunded")) fail("PAYMENT_RECHECK_REQUIRED", "请先核实付款交易，不能对未确认或已退款款项操作", 409);
  if (["approve", "reject", "needs_info"].includes(action) && !["pending", "needs_info"].includes(request.state)) fail("REFUND_STATE", "该申请已通过审核，不能更改审核结论", 409);
  if (action === "processing" && request.state !== "approved") fail("REFUND_STATE", "请先批准退款申请", 409);
  if (action === "refunded" && !["approved", "processing"].includes(request.state)) fail("REFUND_STATE", "请先批准退款申请", 409);
  if (["reject", "needs_info"].includes(action) && !note) fail("PARAM_MISSING", "请填写原因或需要补充的信息");
  const timeoutEligible = request.created_at - (order.paid_at || request.created_at) >= 600_000;
  if (action === "reject" && ["not_delivered", "generation_failed"].includes(request.reason) && timeoutEligible
    && (!order.delivered_at || order.delivered_at > request.created_at)) fail("LATE_IMAGE_NOT_REJECTION", "申请时已满足未交付超时条件，不能因图片晚到而拒绝退款", 409);
  const channel = clean(body.channel, 80), proof = clean(body.proofReference, 200);
  if (action === "refunded" && (!channel || !proof || body.amountFen !== transaction.amount_fen)) fail("REFUND_PROOF_REQUIRED", "请填写真实退款渠道、成功凭证及一致的实退金额", 400);
  const isExtraPayment = Boolean(order.platform_order_no && tradeNo && tradeNo !== order.platform_order_no);
  const primaryRefunded = Boolean(order.primary_refunded || (action === "refunded" && !isExtraPayment));
  const orderState = primaryRefunded && ["refunded", "rejected"].includes(next) ? "refunded" : action === "refunded" && isExtraPayment ? "none" : next;
  const reviewId = crypto.randomUUID();
  const reviewed = await env.PETI_DB.batch([
    env.PETI_DB.prepare("UPDATE refund_requests SET state=?,trade_no=?,amount_fen=?,reviewed_at=?,review_note=?,channel=COALESCE(?,channel),proof_reference=COALESCE(?,proof_reference),refunded_at=?,review_id=? WHERE id=? AND state=? AND (?!='refunded' OR EXISTS (SELECT 1 FROM payment_transactions WHERE trade_no=? AND order_id=? AND state=? AND state!='refunded'))")
      .bind(next, tradeNo || null, transaction?.amount_fen || request.amount_fen, Date.now(), note,
        channel || null, proof || null, action === "refunded" ? Date.now() : null, reviewId, id, request.state, next, tradeNo || null, order.id, transaction?.state || ""),
    env.PETI_DB.prepare("UPDATE orders SET refund_status=?,primary_refunded=MAX(primary_refunded,?) WHERE id=? AND EXISTS (SELECT 1 FROM refund_requests WHERE id=? AND state=? AND review_id=?)")
      .bind(orderState, primaryRefunded ? 1 : 0, order.id, id, next, reviewId),
    env.PETI_DB.prepare("UPDATE payment_transactions SET state='refunded' WHERE trade_no=? AND order_id=? AND ?='refunded' AND EXISTS (SELECT 1 FROM refund_requests WHERE id=? AND state='refunded' AND trade_no=? AND review_id=?)")
      .bind(tradeNo || null, order.id, next, id, tradeNo || null, reviewId),
    env.PETI_DB.prepare("INSERT OR IGNORE INTO avatar_notifications (id,order_id,event) SELECT ?,order_id,? FROM refund_requests WHERE id=? AND state=? AND review_id=?")
      .bind(`${order.id}:refund_${next}:${id}:${reviewId}`, `refund_${next}:${id}:${reviewId}`, id, next, reviewId),
  ]);
  if (!reviewed[0].meta.changes) fail("REFUND_STATE", "申请状态已变化，请刷新后核对", 409);
  await audit(env, order.id, `refund_${next}`, note || channel);
  if (!primaryRefunded && (action === "reject" || (action === "refunded" && isExtraPayment))) {
    const job = await env.PETI_DB.prepare("SELECT * FROM delivery_jobs WHERE order_id=?").bind(order.id).first();
    const attempt = job?.attempt_id && await env.PETI_DB.prepare("SELECT * FROM generation_attempts WHERE id=?").bind(job.attempt_id).first();
    if (attempt?.state === "ready" && await env.PETI_IMAGES.head(attempt.image_key)) await finishStoredImage(env, order.id, attempt.id, attempt.image_key);
    else if (job?.state === "blocked" && (!attempt || attempt.state === "cancelled" || attempt.state === "preparing")) {
      await env.PETI_DB.batch([
        env.PETI_DB.prepare("UPDATE delivery_jobs SET state='pending',next_at=0,lease_until=0,recovery_id=? WHERE order_id=? AND state='blocked' AND attempt_id IS ? AND EXISTS (SELECT 1 FROM orders WHERE id=? AND primary_refunded=0 AND refund_status IN ('none','rejected')) AND EXISTS (SELECT 1 FROM refund_requests WHERE id=? AND review_id=?) AND (SELECT id FROM refund_requests WHERE order_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1)=?")
          .bind(reviewId, order.id, job.attempt_id || null, order.id, id, reviewId, order.id, id),
        env.PETI_DB.prepare("UPDATE orders SET status='unlocked',attempts=MAX(0,attempts-?) WHERE id=? AND status IN ('unlocked','queued','generating') AND primary_refunded=0 AND refund_status IN ('none','rejected') AND EXISTS (SELECT 1 FROM delivery_jobs WHERE order_id=? AND recovery_id=?)")
          .bind(attempt ? 1 : 0, order.id, order.id, reviewId),
        env.PETI_DB.prepare("UPDATE delivery_jobs SET recovery_id=NULL WHERE order_id=? AND recovery_id=?").bind(order.id, reviewId),
      ]);
    }
  }
  return env.PETI_DB.prepare("SELECT * FROM refund_requests WHERE id=?").bind(id).first();
}
