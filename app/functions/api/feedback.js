import { clientIp, rateLimit } from "../lib/api.js";
import { authorize, fail, guarded, isFreeOrder, privateJson, readJson, requireStorage } from "../lib/custom.js";
import { feedbackPayload, latestReadyAttemptId } from "../lib/free-quota.js";

const PRICES = new Set([100, 200, 600]);

// 满意度和心理价位一次性提交；同一张成品重复提交只更新，不产生重复记录。
export const onRequestPost = ({ request, env }) => guarded(async () => {
  if (!rateLimit(`feedback:${clientIp(request)}`, 20)) fail("RATE_LIMITED", "提交过于频繁，请稍后再试", 429);
  requireStorage(env);
  const body = await readJson(request);
  const { token, testId, orderId, attemptId, satisfied, priceFen, skipped } = body;
  const { tokenHash } = await authorize(env, testId, token);
  if (typeof orderId !== "string" || typeof attemptId !== "string") fail("PARAM_MISSING", "缺少订单信息");
  const order = await env.PETI_DB.prepare("SELECT * FROM orders WHERE id=? AND test_id=? AND token_hash=?").bind(orderId, testId, tokenHash).first();
  if (!order) fail("ORDER_NOT_FOUND", "没有找到这笔订单", 404);
  if (!isFreeOrder(order) || order.amount_fen > 0) fail("NOT_FREE_ORDER", "该订单不支持这份反馈", 409);
  if (typeof satisfied !== "boolean") fail("PARAM_MISSING", "请选择是否满意");
  if (priceFen !== undefined && priceFen !== null && !PRICES.has(priceFen)) fail("PRICE_INVALID", "价格选项无效");
  if (skipped !== undefined && typeof skipped !== "boolean") fail("PARAM_MISSING", "参数格式无效");
  // 反馈必须指向当前订单最近一次成功生成的头像，重新生成后旧评价会过期。
  const latest = await latestReadyAttemptId(env, order.id);
  if (!latest || latest !== attemptId) fail("FEEDBACK_STALE", "这份头像已被新的生成替换，请刷新后评价", 409);
  const result = JSON.parse(order.result_json);
  const isSkipped = skipped === true;
  const price = !isSkipped && PRICES.has(priceFen) ? priceFen : null;
  const now = Date.now();
  await env.PETI_DB.prepare("INSERT INTO free_feedback (id, order_id, attempt_id, test_id, satisfied, price_fen, price_answered, skipped, pet_type, role_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(attempt_id) DO UPDATE SET satisfied=excluded.satisfied, price_fen=excluded.price_fen, price_answered=excluded.price_answered, skipped=excluded.skipped, updated_at=excluded.updated_at")
    .bind(crypto.randomUUID(), order.id, attemptId, order.test_id, satisfied ? 1 : 0, price, price == null ? 0 : 1, isSkipped ? 1 : 0, result.petType || null, result.roleId || null, now, now).run();
  const row = await env.PETI_DB.prepare("SELECT * FROM free_feedback WHERE attempt_id=?").bind(attemptId).first();
  return privateJson({ feedback: feedbackPayload(row) });
});
