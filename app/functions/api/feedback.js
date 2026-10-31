import { clientIp, rateLimit } from "../lib/api.js";
import { authorize, fail, guarded, isFreeOrder, privateJson, readJson, requireStorage } from "../lib/custom.js";
import { feedbackPayload, latestReadyAttemptId } from "../lib/free-quota.js";

const PRICES = new Set([100, 200, 600]);
const LEVELS = new Set([1, 2, 3]);
const ISSUES = new Set(["likeness", "style", "detail", "other"]);
const PRICE_BANDS = new Set(["none", "1-2", "3-5", "6-10", "10+"]);

// 问卷按题逐步提交：每答一题就 upsert 一次，未答的字段保持 null。
// 旧客户端只发 satisfied / priceFen，这里映射成三档满意度继续写入。
export const onRequestPost = ({ request, env }) => guarded(async () => {
  if (!rateLimit(`feedback:${clientIp(request)}`, 20)) fail("RATE_LIMITED", "提交过于频繁，请稍后再试", 429);
  requireStorage(env);
  const body = await readJson(request);
  const { token, testId, orderId, attemptId } = body;
  const { tokenHash } = await authorize(env, testId, token);
  if (typeof orderId !== "string" || typeof attemptId !== "string") fail("PARAM_MISSING", "缺少订单信息");
  const order = await env.PETI_DB.prepare("SELECT * FROM orders WHERE id=? AND test_id=? AND token_hash=?").bind(orderId, testId, tokenHash).first();
  if (!order) fail("ORDER_NOT_FOUND", "没有找到这笔订单", 404);
  if (!isFreeOrder(order) || order.amount_fen > 0) fail("NOT_FREE_ORDER", "该订单不支持这份反馈", 409);

  let satisfaction = body.satisfaction;
  if (!LEVELS.has(satisfaction)) {
    if (typeof body.satisfied !== "boolean") fail("PARAM_MISSING", "请选择满意程度");
    satisfaction = body.satisfied ? 3 : 1;
  }
  const similarity = body.similarity ?? null;
  if (similarity !== null && !LEVELS.has(similarity)) fail("PARAM_MISSING", "相似度选项无效");
  const issue = body.issue ?? null;
  if (issue !== null && !ISSUES.has(issue)) fail("PARAM_MISSING", "原因选项无效");
  const priceBand = body.priceBand ?? null;
  if (priceBand !== null && !PRICE_BANDS.has(priceBand)) fail("PRICE_INVALID", "价格选项无效");
  const spendHistory = body.spendHistory ?? null;
  if (spendHistory !== null && !LEVELS.has(spendHistory)) fail("PARAM_MISSING", "付费经历选项无效");
  const legacyPrice = body.priceFen ?? null;
  if (legacyPrice !== null && !PRICES.has(legacyPrice)) fail("PRICE_INVALID", "价格选项无效");

  // 反馈必须指向当前订单最近一次成功生成的头像，重新生成后旧评价会过期。
  const latest = await latestReadyAttemptId(env, order.id);
  if (!latest || latest !== attemptId) fail("FEEDBACK_STALE", "这份头像已被新的生成替换，请刷新后评价", 409);

  const satisfied = satisfaction >= 2;
  // 换分支时清掉另一条路径的字段，避免同一条记录里留下互相矛盾的答案。
  const record = {
    similarity: satisfied ? similarity : null,
    issue: satisfied ? null : issue,
    priceBand: satisfied ? priceBand : null,
    priceFen: satisfied ? legacyPrice : null,
    skipped: satisfied && body.skipped === true ? 1 : 0,
  };
  const priceAnswered = record.priceBand !== null || record.priceFen !== null ? 1 : 0;
  const result = JSON.parse(order.result_json);
  const now = Date.now();
  await env.PETI_DB.prepare("INSERT INTO free_feedback (id, order_id, attempt_id, test_id, satisfied, satisfaction, similarity, issue, price_band, spend_history, price_fen, price_answered, skipped, pet_type, role_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(attempt_id) DO UPDATE SET satisfied=excluded.satisfied, satisfaction=excluded.satisfaction, similarity=excluded.similarity, issue=excluded.issue, price_band=excluded.price_band, spend_history=excluded.spend_history, price_fen=excluded.price_fen, price_answered=excluded.price_answered, skipped=excluded.skipped, updated_at=excluded.updated_at")
    .bind(crypto.randomUUID(), order.id, attemptId, order.test_id, satisfied ? 1 : 0, satisfaction, record.similarity,
      record.issue, record.priceBand, spendHistory, record.priceFen, priceAnswered, record.skipped,
      result.petType || null, result.roleId || null, now, now).run();
  const row = await env.PETI_DB.prepare("SELECT * FROM free_feedback WHERE attempt_id=?").bind(attemptId).first();
  return privateJson({ feedback: feedbackPayload(row) });
});
