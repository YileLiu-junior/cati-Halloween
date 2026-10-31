import { sha256Hex } from "./api.js";

// 浏览器只提交随机 UUID，服务端只保存加盐哈希，避免明文标识入库。
export async function browserKey(browserId) {
  return sha256Hex(`peti-free:${browserId}`);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isBrowserId = (value) => typeof value === "string" && UUID.test(value);

// 当前订单最近一次成功生成的 attempt，反馈只允许指向它。
export async function latestReadyAttemptId(env, orderId) {
  const row = await env.PETI_DB.prepare("SELECT id FROM generation_attempts WHERE order_id=? AND state='ready' ORDER BY finished_at DESC, rowid DESC LIMIT 1").bind(orderId).first();
  return row?.id || null;
}

// 优先展示任务当前 attempt；任务还没开始或已清空时回退到最近一次成功生成。
export async function currentAttemptId(env, orderId) {
  const job = await env.PETI_DB.prepare("SELECT attempt_id FROM delivery_jobs WHERE order_id=?").bind(orderId).first();
  return job?.attempt_id || await latestReadyAttemptId(env, orderId);
}

export function feedbackPayload(row) {
  if (!row) return null;
  return {
    attemptId: row.attempt_id, testId: row.test_id, orderId: row.order_id,
    satisfied: Boolean(row.satisfied), priceFen: row.price_fen ?? null,
    priceAnswered: Boolean(row.price_answered), skipped: Boolean(row.skipped),
    petType: row.pet_type, roleId: row.role_id, updatedAt: row.updated_at,
  };
}

// 统一的额度快照；不调用任何生成配置，服务维护时也能展示已用数量。
export async function freeQuotaSnapshot(env, key) {
  const enabled = env?.FREE_GENERATION_ENABLED !== "false";
  if (!env?.PETI_DB) return snapshot({ enabled: false, total: 0, used: 0, perBrowser: 0, browserUsed: null });
  let quota = null;
  try {
    quota = await env.PETI_DB.prepare("SELECT total, per_browser, used FROM free_quota WHERE id=1").first();
  } catch { quota = null; }
  const total = Number(quota?.total) || 0;
  const used = Number(quota?.used) || 0;
  const perBrowser = Number(quota?.per_browser) || 0;
  let browserUsed = null;
  if (key) {
    try {
      browserUsed = Number((await env.PETI_DB.prepare("SELECT used FROM free_usage WHERE browser_key=?").bind(key).first())?.used) || 0;
    } catch { browserUsed = 0; }
  }
  return snapshot({ enabled: enabled && Boolean(quota), total, used, perBrowser, browserUsed });
}

function snapshot({ enabled, total, used, perBrowser, browserUsed }) {
  const remaining = Math.max(0, total - used);
  const browserRemaining = browserUsed == null ? null : Math.max(0, perBrowser - browserUsed);
  const exhausted = Boolean(enabled && total > 0 && used >= total);
  const browserExhausted = browserUsed != null && perBrowser > 0 && browserUsed >= perBrowser;
  let reason = null;
  if (!enabled) reason = "SERVICE_NOT_CONFIGURED";
  else if (exhausted) reason = "QUOTA_EXHAUSTED";
  else if (browserExhausted) reason = "BROWSER_LIMIT";
  return { enabled, total, used, remaining, perBrowser, browserUsed, browserRemaining, exhausted, browserExhausted, reason };
}

// 条件 UPDATE 命中 0 行在 D1 batch 里不会回滚整批，因此用“请求标记 + 同批补偿”：
// 先写标记并尝试占用，再用标记回填结果；订单未落库时同批把已占额度退回。
function requestStatements(env, input) {
  const { requestId, browserKey: key, now } = input;
  return [
    env.PETI_DB.prepare("INSERT INTO free_requests (id, order_id, created_at) VALUES (?, ?, ?)")
      .bind(requestId, input.orderId, now),
    env.PETI_DB.prepare("UPDATE free_quota SET used=used+1, last_request_id=?, updated_at=? WHERE id=1 AND used<total")
      .bind(requestId, now),
    env.PETI_DB.prepare("UPDATE free_requests SET quota_ok=1 WHERE id=? AND EXISTS (SELECT 1 FROM free_quota WHERE id=1 AND last_request_id=?)")
      .bind(requestId, requestId),
    env.PETI_DB.prepare("INSERT INTO free_usage (browser_key, used, last_request_id, created_at, updated_at) VALUES (?, 1, ?, ?, ?) ON CONFLICT(browser_key) DO UPDATE SET used=used+1, last_request_id=excluded.last_request_id, updated_at=excluded.updated_at WHERE free_usage.used < (SELECT per_browser FROM free_quota WHERE id=1)")
      .bind(key, requestId, now, now),
    env.PETI_DB.prepare("UPDATE free_requests SET browser_ok=1 WHERE id=? AND EXISTS (SELECT 1 FROM free_usage WHERE browser_key=? AND last_request_id=?)")
      .bind(requestId, key, requestId),
  ];
}

// 补偿只在“本次确实占用了额度、且对应订单没有落库”时生效。
function refundStatements(env, input) {
  const { requestId, browserKey: key, now } = input;
  return [
    env.PETI_DB.prepare("UPDATE free_quota SET used=MAX(0, used-1), last_request_id=NULL, updated_at=? WHERE id=1 AND EXISTS (SELECT 1 FROM free_requests WHERE id=? AND quota_ok=1) AND NOT EXISTS (SELECT 1 FROM orders WHERE free_request_id=?)")
      .bind(now, requestId, requestId),
    env.PETI_DB.prepare("UPDATE free_usage SET used=MAX(0, used-1), last_request_id=NULL, updated_at=? WHERE browser_key=? AND EXISTS (SELECT 1 FROM free_requests WHERE id=? AND browser_ok=1) AND NOT EXISTS (SELECT 1 FROM orders WHERE free_request_id=?)")
      .bind(now, key, requestId, requestId),
  ];
}

const resultOf = (results, index) => Boolean(results?.[index]?.meta?.changes);

// 首次免费生成：占额度并写入 free 订单。
export async function reserveAndCreateFreeOrder(env, input) {
  const { requestId, orderId, testId, tokenHash, photoId, resultJson, expiresAt, browserKey: key, now } = input;
  const results = await env.PETI_DB.batch([
    ...requestStatements(env, input),
    env.PETI_DB.prepare("INSERT OR IGNORE INTO orders (id, test_id, token_hash, photo_id, amount_fen, plan_id, sku_id, result_json, status, created_at, expires_at, free_browser_key, free_request_id, free_sequence, free_quota_charged) SELECT ?, ?, ?, ?, 0, 'free', 'free', ?, 'unlocked', ?, ?, ?, ?, 1, 1 FROM free_requests WHERE id=? AND quota_ok=1 AND browser_ok=1")
      .bind(orderId, testId, tokenHash, photoId, resultJson, now, expiresAt, key, requestId, requestId),
    ...refundStatements(env, input),
    env.PETI_DB.prepare("INSERT OR IGNORE INTO delivery_jobs (order_id, updated_at) SELECT id, ? FROM orders WHERE id=? AND free_request_id=?")
      .bind(now, orderId, requestId),
  ]);
  if (!resultOf(results, 1)) return { ok: false, code: "FREE_QUOTA_EXHAUSTED" };
  if (!resultOf(results, 3)) return { ok: false, code: "FREE_BROWSER_LIMIT" };
  if (!resultOf(results, 5)) {
    // 并发或重复：本次已同批退回额度，关闭请求标记后由调用方返回现有订单。
    await env.PETI_DB.prepare("UPDATE free_requests SET quota_ok=0, browser_ok=0 WHERE id=?").bind(requestId).run();
    return { ok: false, code: "FREE_REQUEST_CONFLICT" };
  }
  return { ok: true, orderId };
}

// 重新生成复用原订单行（orders.test_id 唯一），但重新占用一次额度。
export async function reserveAndResetFreeOrder(env, input) {
  const { requestId, orderId, photoId, resultJson, expiresAt, now } = input;
  const results = await env.PETI_DB.batch([
    ...requestStatements(env, input),
    env.PETI_DB.prepare("UPDATE orders SET photo_id=?, result_json=?, status='unlocked', attempts=0, retryable=0, error_code=NULL, image_key=NULL, delivered_at=NULL, expires_at=?, free_request_id=?, free_sequence=free_sequence+1, free_quota_charged=1, free_quota_refunded=0, free_refund_attempt_id=NULL, refund_status='none', primary_refunded=0 WHERE id=? AND amount_fen=0 AND plan_id='free' AND status IN ('ready','failed','uncertain') AND EXISTS (SELECT 1 FROM free_requests WHERE id=? AND quota_ok=1 AND browser_ok=1)")
      .bind(photoId, resultJson, expiresAt, requestId, orderId, requestId),
    ...refundStatements(env, input),
    env.PETI_DB.prepare("INSERT OR IGNORE INTO delivery_jobs (order_id, updated_at) SELECT id, ? FROM orders WHERE id=? AND free_request_id=?")
      .bind(now, orderId, requestId),
    env.PETI_DB.prepare("UPDATE delivery_jobs SET state='pending', attempt_id=NULL, next_at=0, lease_until=0, recovery_id=NULL, error_code=NULL, updated_at=? WHERE order_id=? AND EXISTS (SELECT 1 FROM orders WHERE id=? AND free_request_id=? AND status='unlocked')")
      .bind(now, orderId, orderId, requestId),
  ]);
  if (!resultOf(results, 1)) return { ok: false, code: "FREE_QUOTA_EXHAUSTED" };
  if (!resultOf(results, 3)) return { ok: false, code: "FREE_BROWSER_LIMIT" };
  if (!resultOf(results, 5)) {
    await env.PETI_DB.prepare("UPDATE free_requests SET quota_ok=0, browser_ok=0 WHERE id=?").bind(requestId).run();
    return { ok: false, code: "FREE_REQUEST_CONFLICT" };
  }
  return { ok: true, orderId };
}

// 生成失败退回：先记 attempt 台账，只有台账未处理过才扣回；同一 attempt 重复调用不会二次扣减。
export async function releaseFreeQuotaForAttempt(env, attemptId, orderId) {
  if (!env?.PETI_DB || typeof attemptId !== "string" || !attemptId) return false;
  const now = Date.now();
  const results = await env.PETI_DB.batch([
    env.PETI_DB.prepare("INSERT OR IGNORE INTO free_quota_refunds (attempt_id, order_id, browser_key, applied, created_at) SELECT ?, id, free_browser_key, 0, ? FROM orders WHERE id=? AND amount_fen=0 AND plan_id='free' AND free_quota_charged=1 AND free_quota_refunded=0 AND EXISTS (SELECT 1 FROM generation_attempts WHERE id=? AND order_id=?)")
      .bind(attemptId, now, orderId, attemptId, orderId),
    env.PETI_DB.prepare("UPDATE free_quota SET used=MAX(0, used-1), updated_at=? WHERE id=1 AND EXISTS (SELECT 1 FROM free_quota_refunds WHERE attempt_id=? AND applied=0) AND EXISTS (SELECT 1 FROM orders WHERE id=? AND free_quota_refunded=0)")
      .bind(now, attemptId, orderId),
    env.PETI_DB.prepare("UPDATE free_usage SET used=MAX(0, used-1), updated_at=? WHERE browser_key=(SELECT browser_key FROM free_quota_refunds WHERE attempt_id=?) AND EXISTS (SELECT 1 FROM free_quota_refunds WHERE attempt_id=? AND applied=0) AND EXISTS (SELECT 1 FROM orders WHERE id=? AND free_quota_refunded=0)")
      .bind(now, attemptId, attemptId, orderId),
    env.PETI_DB.prepare("UPDATE orders SET free_quota_refunded=1, free_refund_attempt_id=? WHERE id=? AND free_quota_refunded=0 AND EXISTS (SELECT 1 FROM free_quota_refunds WHERE attempt_id=? AND applied=0)")
      .bind(attemptId, orderId, attemptId),
    env.PETI_DB.prepare("UPDATE free_quota_refunds SET applied=1 WHERE attempt_id=? AND applied=0")
      .bind(attemptId),
  ]);
  return resultOf(results, 0);
}
