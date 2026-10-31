import { buildImageRequest, generateImage } from "./generate.js";
import { isFreeOrder, readPhoto, PHOTO_TTL, requireGeneration } from "./custom.js";
import { refundLocked } from "./delivery-store.js";

export async function processGeneration(env, orderId) {
  const order = await env.PETI_DB.prepare("SELECT * FROM orders WHERE id=?").bind(orderId).first();
  if (!order || refundLocked(order) || !["unlocked", "queued"].includes(order.status)) return;
  const attemptId = crypto.randomUUID(), now = Date.now();
  const imageKey = `jobs/${orderId}/${attemptId}.png`;
  const claimed = await env.PETI_DB.batch([
    env.PETI_DB.prepare("UPDATE delivery_jobs SET state='running',attempt_id=?,lease_until=?,updated_at=? WHERE order_id=? AND state IN ('pending','queued') AND EXISTS (SELECT 1 FROM orders WHERE id=order_id AND status IN ('unlocked','queued') AND refund_status IN ('none','rejected') AND attempts<2)")
      .bind(attemptId, now + 420_000, now, orderId),
    env.PETI_DB.prepare("UPDATE orders SET status='generating',attempts=attempts+1,retryable=0,error_code=NULL,started_at=? WHERE id=? AND EXISTS (SELECT 1 FROM delivery_jobs WHERE order_id=? AND attempt_id=?)")
      .bind(now, orderId, orderId, attemptId),
    env.PETI_DB.prepare("INSERT INTO generation_attempts (id,order_id,state,stage,started_at,image_key) SELECT ?,id,'preparing','preparing',?,? FROM orders WHERE id=? AND EXISTS (SELECT 1 FROM delivery_jobs WHERE order_id=? AND attempt_id=?)")
      .bind(attemptId, now, imageKey, orderId, orderId, attemptId),
  ]);
  if (!claimed[0].meta.changes) return;
  let called = false, cancelled = false;
  try {
    const result = JSON.parse(order.result_json);
    await requireGeneration(env, result, isFreeOrder(order));
    const photo = await readPhoto(env, order.photo_id, order.token_hash);
    const request = await buildImageRequest(env, result, photo);
    // 再查退款锁，申请在备料期间到达时不启动收费调用。
    const current = await env.PETI_DB.prepare("SELECT * FROM orders WHERE id=?").bind(orderId).first();
    if (refundLocked(current)) {
      await env.PETI_DB.prepare("UPDATE generation_attempts SET state='cancelled',stage='cancelled',finished_at=? WHERE id=?").bind(Date.now(), attemptId).run();
      await env.PETI_DB.prepare("UPDATE delivery_jobs SET state='blocked',lease_until=0 WHERE order_id=? AND attempt_id=? AND state='running'").bind(orderId, attemptId).run();
      return;
    }
    const output = await generateImage(env, request, { onEvent: async event => {
      const saved = await env.PETI_DB.prepare("UPDATE generation_attempts SET state=?,stage=?,http_status=COALESCE(?,http_status),request_id=COALESCE(?,request_id) WHERE id=? AND (?!='calling' OR (state='preparing' AND EXISTS (SELECT 1 FROM orders WHERE id=? AND status='generating' AND refund_status IN ('none','rejected')) AND EXISTS (SELECT 1 FROM delivery_jobs WHERE order_id=? AND attempt_id=? AND state='running' AND lease_until>?)))")
        .bind(event.stage, event.stage, event.httpStatus ?? null, event.requestId?.slice(0, 160) || null, attemptId, event.stage, orderId, orderId, attemptId, Date.now()).run();
      if (!saved.meta.changes) { cancelled = true; throw new Error("Generation cancelled before call"); }
      if (event.stage === "calling") called = true;
    } });
    if (cancelled) {
      await env.PETI_DB.prepare("UPDATE generation_attempts SET state='cancelled',stage='cancelled',finished_at=? WHERE id=?").bind(Date.now(), attemptId).run();
      await env.PETI_DB.prepare("UPDATE delivery_jobs SET state='blocked',lease_until=0 WHERE order_id=? AND attempt_id=? AND state='running'").bind(orderId, attemptId).run();
      return;
    }
    if (output.status !== "ready") {
      const retryable = output.errorCode === "QUOTA_EXCEEDED" && order.attempts < 1;
      await finishFailure(env, orderId, attemptId, output.status, output.errorCode, retryable);
      return;
    }
    await env.PETI_IMAGES.put(imageKey, output.image, { httpMetadata: { contentType: "image/png" } });
    await env.PETI_DB.prepare("UPDATE generation_attempts SET state='ready',stage='stored',finished_at=?,elapsed_ms=? WHERE id=?")
      .bind(Date.now(), Date.now() - now, attemptId).run();
    await finishStoredImage(env, orderId, attemptId, imageKey);
  } catch (error) {
    let code = called ? "GENERATION_UNCERTAIN" : "GENERATION_PREPARATION_FAILED";
    if (error instanceof Response) code = (await error.clone().json().catch(() => null))?.code || code;
    await finishFailure(env, orderId, attemptId, called ? "uncertain" : "failed", code, false);
  }
}

export async function finishStoredImage(env, orderId, attemptId, imageKey, recoveryId = null) {
  await env.PETI_DB.batch([
    env.PETI_DB.prepare("UPDATE orders SET status='ready',image_key=?,delivered_at=?,expires_at=?,error_code=NULL WHERE id=? AND status IN ('generating','uncertain') AND primary_refunded=0 AND refund_status IN ('none','rejected') AND EXISTS (SELECT 1 FROM delivery_jobs WHERE order_id=? AND attempt_id=? AND (? IS NULL OR recovery_id=?))")
      .bind(imageKey, Date.now(), Date.now() + PHOTO_TTL, orderId, orderId, attemptId, recoveryId, recoveryId),
    env.PETI_DB.prepare("UPDATE delivery_jobs SET state=CASE WHEN EXISTS (SELECT 1 FROM orders WHERE id=? AND status='ready' AND image_key=? AND primary_refunded=0 AND refund_status IN ('none','rejected')) THEN 'succeeded' ELSE 'blocked' END,lease_until=0,recovery_id=NULL,updated_at=? WHERE order_id=? AND attempt_id=? AND (? IS NULL OR recovery_id=?)")
      .bind(orderId, imageKey, Date.now(), orderId, attemptId, recoveryId, recoveryId),
    env.PETI_DB.prepare("INSERT OR IGNORE INTO avatar_notifications (id,order_id,event) SELECT ?,id,'ready' FROM orders WHERE id=? AND status='ready' AND image_key=? AND amount_fen>0 AND primary_refunded=0 AND refund_status IN ('none','rejected')")
      .bind(`${orderId}:ready`, orderId, imageKey),
  ]);
}

async function finishFailure(env, orderId, attemptId, state, code, retryable, recoveryId = null) {
  const now = Date.now();
  await env.PETI_DB.batch([
    env.PETI_DB.prepare("UPDATE generation_attempts SET state=?,stage='finished',finished_at=?,elapsed_ms=?-started_at,error_code=? WHERE id=? AND EXISTS (SELECT 1 FROM delivery_jobs WHERE order_id=? AND attempt_id=? AND ((? IS NULL AND state IN ('running','recovering','uncertain')) OR recovery_id=?))")
      .bind(state, now, now, code, attemptId, orderId, attemptId, recoveryId, recoveryId),
    env.PETI_DB.prepare("UPDATE orders SET status=?,retryable=?,error_code=? WHERE id=? AND status IN ('generating','uncertain') AND EXISTS (SELECT 1 FROM delivery_jobs WHERE order_id=? AND attempt_id=? AND ((? IS NULL AND state IN ('running','recovering','uncertain')) OR recovery_id=?))")
      .bind(state, retryable ? 1 : 0, code, orderId, orderId, attemptId, recoveryId, recoveryId),
    // 免费单失败退回：先按 attempt 记台账，只有台账未处理过才退回，重复调用不会二次扣减。
    env.PETI_DB.prepare("INSERT OR IGNORE INTO free_quota_refunds (attempt_id, order_id, browser_key, applied, created_at) SELECT ?, id, free_browser_key, 0, ? FROM orders WHERE id=? AND amount_fen=0 AND plan_id='free' AND free_quota_charged=1 AND free_quota_refunded=0 AND status=? AND EXISTS (SELECT 1 FROM delivery_jobs WHERE order_id=? AND attempt_id=? AND ((? IS NULL AND state IN ('running','recovering','uncertain')) OR recovery_id=?))")
      .bind(attemptId, now, orderId, state, orderId, attemptId, recoveryId, recoveryId),
    env.PETI_DB.prepare("UPDATE free_quota SET used=MAX(0, used-1), updated_at=? WHERE id=1 AND EXISTS (SELECT 1 FROM free_quota_refunds WHERE attempt_id=? AND applied=0) AND EXISTS (SELECT 1 FROM orders WHERE id=? AND free_quota_refunded=0)")
      .bind(now, attemptId, orderId),
    env.PETI_DB.prepare("UPDATE free_usage SET used=MAX(0, used-1), updated_at=? WHERE browser_key=(SELECT browser_key FROM free_quota_refunds WHERE attempt_id=?) AND EXISTS (SELECT 1 FROM free_quota_refunds WHERE attempt_id=? AND applied=0) AND EXISTS (SELECT 1 FROM orders WHERE id=? AND free_quota_refunded=0)")
      .bind(now, attemptId, attemptId, orderId),
    env.PETI_DB.prepare("UPDATE orders SET free_quota_refunded=1, free_refund_attempt_id=? WHERE id=? AND free_quota_refunded=0 AND EXISTS (SELECT 1 FROM free_quota_refunds WHERE attempt_id=? AND applied=0)")
      .bind(attemptId, orderId, attemptId),
    env.PETI_DB.prepare("UPDATE free_quota_refunds SET applied=1 WHERE attempt_id=? AND applied=0")
      .bind(attemptId),
    env.PETI_DB.prepare("UPDATE delivery_jobs SET state=?,lease_until=0,recovery_id=NULL,updated_at=?,error_code=? WHERE order_id=? AND attempt_id=? AND ((? IS NULL AND state IN ('running','recovering','uncertain')) OR recovery_id=?)")
      .bind(state, now, code, orderId, attemptId, recoveryId, recoveryId),
    // 免费单没有私信通知渠道，避免写入永远 pending 的提醒。
    env.PETI_DB.prepare("INSERT OR IGNORE INTO avatar_notifications (id,order_id,event) SELECT ?,id,'failed' FROM orders WHERE id=? AND amount_fen>0 AND status IN ('failed','uncertain') AND EXISTS (SELECT 1 FROM delivery_jobs WHERE order_id=? AND attempt_id=?)")
      .bind(`${orderId}:failed`, orderId, orderId, attemptId),
  ]);
}

export async function recoverStaleGenerations(env) {
  // 先处理租约过期的运行任务，未知结果的检查不能占满这个批次。
  const { results } = await env.PETI_DB.prepare("SELECT * FROM delivery_jobs WHERE state IN ('running','recovering') AND lease_until<? ORDER BY lease_until LIMIT 20").bind(Date.now()).all();
  for (const job of results) {
    const recoveryId = crypto.randomUUID();
    const claimed = await env.PETI_DB.prepare("UPDATE delivery_jobs SET state='recovering',recovery_id=?,lease_until=?,updated_at=? WHERE order_id=? AND attempt_id=? AND state IN ('running','recovering') AND lease_until<?")
      .bind(recoveryId, Date.now() + 60_000, Date.now(), job.order_id, job.attempt_id, Date.now()).run();
    if (!claimed.meta.changes) continue;
    const attempt = await env.PETI_DB.prepare("SELECT * FROM generation_attempts WHERE id=?").bind(job.attempt_id).first();
    if (attempt?.image_key && await env.PETI_IMAGES.head(attempt.image_key)) {
      await env.PETI_DB.prepare("UPDATE generation_attempts SET state='ready',stage='recovered',finished_at=? WHERE id=? AND EXISTS (SELECT 1 FROM delivery_jobs WHERE order_id=? AND recovery_id=?)")
        .bind(Date.now(), attempt.id, job.order_id, recoveryId).run();
      await finishStoredImage(env, job.order_id, attempt.id, attempt.image_key, recoveryId);
    } else if (attempt?.state === "preparing") {
      await env.PETI_DB.batch([
        env.PETI_DB.prepare("UPDATE generation_attempts SET state='cancelled',error_code='INTERRUPTED_BEFORE_CALL',finished_at=? WHERE id=? AND EXISTS (SELECT 1 FROM delivery_jobs WHERE order_id=? AND attempt_id=? AND recovery_id=?)")
          .bind(Date.now(), attempt.id, job.order_id, attempt.id, recoveryId),
        env.PETI_DB.prepare("UPDATE orders SET status='unlocked',attempts=MAX(0,attempts-1) WHERE id=? AND status='generating' AND EXISTS (SELECT 1 FROM delivery_jobs WHERE order_id=? AND attempt_id=? AND recovery_id=?)")
          .bind(job.order_id, job.order_id, attempt.id, recoveryId),
        env.PETI_DB.prepare("UPDATE delivery_jobs SET state='pending',lease_until=0,next_at=0,recovery_id=NULL WHERE order_id=? AND attempt_id=? AND recovery_id=?")
          .bind(job.order_id, attempt.id, recoveryId),
      ]);
    } else {
      await finishFailure(env, job.order_id, job.attempt_id, "uncertain", "WORKER_INTERRUPTED_AFTER_CALL", false, recoveryId);
    }
  }
  // 未知结果只轮流查落盘成品，不重新调用模型。
  const { results: uncertain } = await env.PETI_DB.prepare("SELECT * FROM delivery_jobs WHERE state='uncertain' AND next_at<=? ORDER BY next_at LIMIT 20").bind(Date.now()).all();
  for (const job of uncertain) {
    await env.PETI_DB.prepare("UPDATE delivery_jobs SET next_at=? WHERE order_id=? AND state='uncertain' AND attempt_id=?").bind(Date.now() + 300_000, job.order_id, job.attempt_id).run();
    const attempt = await env.PETI_DB.prepare("SELECT * FROM generation_attempts WHERE id=?").bind(job.attempt_id).first();
    if (attempt?.image_key && await env.PETI_IMAGES.head(attempt.image_key)) {
      await env.PETI_DB.prepare("UPDATE generation_attempts SET state='ready',stage='recovered',finished_at=? WHERE id=?").bind(Date.now(), attempt.id).run();
      await finishStoredImage(env, job.order_id, attempt.id, attempt.image_key);
    }
  }
}
