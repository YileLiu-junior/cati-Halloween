import { clientIp, rateLimit } from "../lib/api.js";
import { authorize, fail, guarded, isFreeOrder, orderPayload, privateJson, readJson, readPhoto, requireFreeGeneration, requireStorage } from "../lib/custom.js";
import { generationProfile, generationSnapshot } from "../lib/generation-config.js";
import { browserKey, currentAttemptId, feedbackPayload, freeQuotaSnapshot, isBrowserId, reserveAndCreateFreeOrder, reserveAndResetFreeOrder } from "../lib/free-quota.js";
import { queueGeneration } from "../lib/delivery-store.js";

// 进行中的订单用 202，已有结论（可查看/保存）的订单用 200。
const statusFor = (status) => ["unlocked", "queued", "generating"].includes(status) ? 202 : 200;

async function responseFor(env, order, key, { idempotent, status } = {}) {
  const attemptId = await currentAttemptId(env, order.id);
  const feedbackRow = attemptId ? await env.PETI_DB.prepare("SELECT * FROM free_feedback WHERE attempt_id=?").bind(attemptId).first() : null;
  const payload = { ...orderPayload(order), orderId: order.id, free: isFreeOrder(order), attemptId };
  return privateJson({ order: payload, feedback: feedbackPayload(feedbackRow), free: await freeQuotaSnapshot(env, key), idempotent: Boolean(idempotent) }, status ?? statusFor(order.status));
}

function reservationFailure(code) {
  if (code === "FREE_QUOTA_EXHAUSTED") fail("FREE_QUOTA_EXHAUSTED", "免费名额已用完，感谢参与", 409);
  if (code === "FREE_BROWSER_LIMIT") fail("FREE_BROWSER_LIMIT", "这台浏览器已用完免费次数", 429);
}

export const onRequestPost = ({ request, env }) => guarded(async () => {
  if (!rateLimit(`free-ip:${clientIp(request)}`, 12)) fail("RATE_LIMITED", "提交过于频繁，请稍后再试", 429, true);
  requireStorage(env);
  const body = await readJson(request);
  const { token, testId, photoId, roleId, browserId, regenerate } = body;
  const { tokenHash, result } = await authorize(env, testId, token);
  if (!isBrowserId(browserId)) fail("BROWSER_ID_REQUIRED", "请使用支持本地存储的浏览器打开本页", 400);
  if (typeof roleId !== "string" || !Object.hasOwn(generationProfile(result.petType)?.roleImageKeys || {}, roleId)) fail("ROLE_INVALID", "请选择有效的角色");
  const photo = await readPhoto(env, photoId, tokenHash);
  if (photo.test_id !== testId) fail("PHOTO_INVALID", "照片不属于这份测评");
  const selectedResult = { ...result, testRoleId: result.roleId, roleId };
  selectedResult.generation = generationSnapshot(selectedResult);
  await requireFreeGeneration(env, selectedResult);
  const key = await browserKey(browserId);
  const now = Date.now();
  const existing = await env.PETI_DB.prepare("SELECT * FROM orders WHERE test_id=?").bind(testId).first();

  if (existing) {
    // 付款链路休眠后，历史待付款或已付款订单不再进入免费流程。
    if (existing.amount_fen > 0) fail("LEGACY_ORDER_EXISTS", "这份结果已有付费订单，请联系作者处理", 409);
    if (existing.status === "unpaid") fail("LEGACY_ORDER_PENDING", "这份结果已有待付款订单，请联系作者处理", 409);
    // 没有明确要求重试，或当前状态不能重试时，直接返回已有订单且不扣额度。
    if (regenerate !== true || !["ready", "failed", "uncertain"].includes(existing.status)) {
      return responseFor(env, existing, key, { idempotent: true });
    }
    const reserved = await reserveAndResetFreeOrder(env, {
      requestId: crypto.randomUUID(), orderId: existing.id, browserKey: key,
      photoId, resultJson: JSON.stringify(selectedResult), expiresAt: photo.expires_at, now,
    });
    if (!reserved.ok) {
      reservationFailure(reserved.code);
      const order = await env.PETI_DB.prepare("SELECT * FROM orders WHERE id=?").bind(existing.id).first();
      return responseFor(env, order, key, { idempotent: true });
    }
    await queueGeneration(env, existing.id);
    const order = await env.PETI_DB.prepare("SELECT * FROM orders WHERE id=?").bind(existing.id).first();
    return responseFor(env, order, key, { idempotent: false, status: 202 });
  }

  const orderId = crypto.randomUUID();
  const reserved = await reserveAndCreateFreeOrder(env, {
    requestId: crypto.randomUUID(), orderId, testId, tokenHash, photoId,
    resultJson: JSON.stringify(selectedResult), expiresAt: photo.expires_at, browserKey: key, now,
  });
  if (!reserved.ok) {
    reservationFailure(reserved.code);
    // 并发请求已经建好订单：本次额度已同批退回，返回现有订单。
    const concurrent = await env.PETI_DB.prepare("SELECT * FROM orders WHERE test_id=?").bind(testId).first();
    if (!concurrent) fail("FREE_REQUEST_CONFLICT", "提交发生冲突，请稍后重试", 409);
    return responseFor(env, concurrent, key, { idempotent: true });
  }
  await queueGeneration(env, orderId);
  const order = await env.PETI_DB.prepare("SELECT * FROM orders WHERE id=?").bind(orderId).first();
  return responseFor(env, order, key, { idempotent: false, status: 202 });
});

// 查看入口不检查维护状态：额度耗尽或服务维护时，已生成的头像仍要能查看和保存。
export const onRequestGet = ({ request, env }) => guarded(async () => {
  requireStorage(env);
  const query = new URL(request.url).searchParams;
  const testId = query.get("testId");
  const { tokenHash } = await authorize(env, testId, request.headers.get("X-PT-Token"));
  const browserId = query.get("browserId");
  const key = isBrowserId(browserId) ? await browserKey(browserId) : null;
  const free = await freeQuotaSnapshot(env, key);
  const order = await env.PETI_DB.prepare("SELECT * FROM orders WHERE test_id=? AND token_hash=?").bind(testId, tokenHash).first();
  if (!order) return privateJson({ order: null, feedback: null, free });
  const attemptId = await currentAttemptId(env, order.id);
  const feedbackRow = attemptId ? await env.PETI_DB.prepare("SELECT * FROM free_feedback WHERE attempt_id=?").bind(attemptId).first() : null;
  return privateJson({ order: { ...orderPayload(order), orderId: order.id, free: isFreeOrder(order), attemptId }, feedback: feedbackPayload(feedbackRow), free });
});
