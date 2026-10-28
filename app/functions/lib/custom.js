import { apiError, json, sha256Hex } from "./api.js";
import { GENERATION_CONFIG } from "./generation-config.js";

export const PHOTO_TTL = 7 * 24 * 60 * 60 * 1000;
export const CUTOFF = Date.parse("2026-10-31T00:00:00+08:00");
export const amountFen = (now = Date.now()) => now < CUTOFF ? 200 : 590;

export function fail(code, message, status = 400, retryable = false) {
  throw apiError(code, message, status, retryable);
}

export function privateJson(data, status = 200) {
  const response = json(data, status);
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function guarded(action) {
  try { return await action(); }
  catch (error) {
    const response = error instanceof Response ? error : apiError("SERVER_ERROR", "服务暂时不可用，请稍后重试", 503, true);
    response.headers.set("cache-control", "no-store");
    return response;
  }
}

export function requireStorage(env) {
  if (!env.PETI_DB || !env.PETI_IMAGES) fail("SERVICE_NOT_CONFIGURED", "定制服务尚未开放，请稍后再来", 503);
}

export async function authorize(env, testId, token) {
  if (typeof testId !== "string" || typeof token !== "string" || !/^[a-f0-9]{32}$/.test(token)) {
    fail("TOKEN_INVALID", "当前结果凭证无效，请回首页重新查看", 401);
  }
  const raw = await env.PETI_KV.get(`session:${testId}`);
  const tokenHash = await sha256Hex(token);
  if (!raw || JSON.parse(raw).tokenHash !== tokenHash) fail("TOKEN_INVALID", "当前结果凭证无效或已过期", 401);
  const result = JSON.parse(await env.PETI_KV.get(`result:${testId}`) || "null");
  if (!result || result.status !== "completed" || result.tokenHash !== tokenHash) fail("RESULT_REQUIRED", "请先完成宠物测评", 409);
  return { result, tokenHash };
}

export function paymentConfigured(env) {
  if (![env.AFDIAN_USER_ID, env.AFDIAN_API_TOKEN, env.AFDIAN_PLAN_ID, env.AFDIAN_PAY_URL].every((value) => typeof value === "string" && value.trim())) return false;
  try {
    const url = new URL(env.AFDIAN_PAY_URL);
    return url.protocol === "https:" && ["afdian.com", "afdian.net"].includes(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}

export function generationConfigured(env) {
  return Boolean(env.OPENAI_API_KEY?.trim() && GENERATION_CONFIG.prompt.trim() && GENERATION_CONFIG.referenceImageKeys.length);
}

export async function requireGeneration(env) {
  if (!generationConfigured(env)) fail("SERVICE_NOT_CONFIGURED", "定制服务尚未开放，暂不收款", 503);
  if (GENERATION_CONFIG.referenceImageKeys.length > 15) fail("SERVICE_NOT_CONFIGURED", "定制素材配置有误，暂不收款", 503);
  for (const key of GENERATION_CONFIG.referenceImageKeys) {
    const object = typeof key === "string" && key.startsWith("references/") ? await env.PETI_IMAGES.head(key) : null;
    if (!object || !["image/png", "image/jpeg", "image/webp"].includes(object.httpMetadata?.contentType) || object.size > 10 * 1024 * 1024) {
      fail("SERVICE_NOT_CONFIGURED", "定制素材尚未就绪，暂不收款", 503);
    }
  }
}

export async function loadOrder(env, id, token) {
  requireStorage(env);
  const order = await env.PETI_DB.prepare("SELECT * FROM orders WHERE id = ?").bind(id).first();
  if (!order) fail("ORDER_NOT_FOUND", "没有找到这笔订单", 404);
  // 订单凭证独立于免费结果的 30 天 TTL，已付未交付订单仍可取回。
  if (typeof token !== "string" || await sha256Hex(token) !== order.token_hash) fail("TOKEN_INVALID", "订单凭证无效", 401);
  if (order.status === "generating" && Date.now() - order.started_at > 200_000) {
    await env.PETI_DB.prepare("UPDATE orders SET status = 'uncertain', retryable = 0, error_code = 'GENERATION_UNCERTAIN' WHERE id = ? AND status = 'generating'").bind(id).run();
    return { ...order, status: "uncertain", retryable: 0, error_code: "GENERATION_UNCERTAIN" };
  }
  return order;
}

export function orderPayload(order) {
  return {
    payId: order.id, jobId: order.id, photoId: order.photo_id, status: order.status,
    amountFen: order.amount_fen, expiresAt: new Date(order.expires_at).toISOString(),
    retryable: Boolean(order.retryable && order.attempts < 2), errorCode: order.error_code,
    imageUrl: order.status === "ready" ? `/api/jobs/${order.id}/image` : null,
  };
}

export async function readPhoto(env, id, tokenHash) {
  const photo = await env.PETI_DB.prepare("SELECT * FROM photos WHERE id = ?").bind(id).first();
  if (!photo || photo.token_hash !== tokenHash) fail("PHOTO_INVALID", "请重新上传宠物照片", 400);
  if (photo.expires_at <= Date.now()) {
    await env.PETI_IMAGES.delete(photo.object_key);
    fail("PHOTO_EXPIRED", "照片已过保留期，请联系作者处理已付订单", 410);
  }
  return photo;
}

export function privateImage(body, type) {
  return new Response(body, { headers: { "content-type": type, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
}

// 浏览器先重编码为 JPEG，服务端继续核验文件签名、尺寸和长度。
export function jpegDimensions(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset++;
    if (offset + 3 > bytes.length) return null;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (length < 8) return null;
      return { height: view.getUint16(offset + 3), width: view.getUint16(offset + 5) };
    }
    offset += length;
  }
  return null;
}
