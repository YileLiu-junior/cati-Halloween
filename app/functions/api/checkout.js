import { authorize, amountFen, fail, guarded, orderPayload, paymentConfigured, privateJson, readPhoto, requireGeneration, requireStorage } from "../lib/custom.js";

export const onRequestPost = ({ request, env }) => guarded(async () => {
  requireStorage(env);
  const { token, testId, photoId } = await request.json();
  const { tokenHash, result } = await authorize(env, testId, token);
  const photo = await readPhoto(env, photoId, tokenHash);
  if (photo.test_id !== testId) fail("PHOTO_INVALID", "照片不属于这份测评");
  await requireGeneration(env);
  if (!paymentConfigured(env)) fail("SERVICE_NOT_CONFIGURED", "支付尚未开放，暂不收款", 503);
  await env.PETI_DB.prepare("INSERT OR IGNORE INTO orders (id, test_id, token_hash, photo_id, amount_fen, plan_id, sku_id, result_json, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), testId, tokenHash, photoId, amountFen(), env.AFDIAN_PLAN_ID, env.AFDIAN_SKU_ID, JSON.stringify(result), Date.now(), photo.expires_at).run();
  const order = await env.PETI_DB.prepare("SELECT * FROM orders WHERE test_id = ?").bind(testId).first();
  if (order.status === "unpaid" && order.amount_fen !== amountFen()) fail("PAY_ID_STALE", "原订单报价已过期，请联系作者核对，暂勿付款", 409);
  if (order.status === "unpaid" && (order.plan_id !== env.AFDIAN_PLAN_ID || order.sku_id !== env.AFDIAN_SKU_ID)) fail("ORDER_PRODUCT_CHANGED", "原订单对应的商品型号已变更，请联系作者处理，暂勿付款", 409);
  const payUrl = new URL(env.AFDIAN_PAY_URL);
  payUrl.searchParams.set("remark", order.id);
  return privateJson({ ...orderPayload(order), payUrl: payUrl.href, paymentReference: order.id });
});

export const onRequestGet = ({ request, env }) => guarded(async () => {
  requireStorage(env);
  const testId = new URL(request.url).searchParams.get("testId");
  const { tokenHash } = await authorize(env, testId, request.headers.get("X-PT-Token"));
  const order = await env.PETI_DB.prepare("SELECT * FROM orders WHERE test_id = ? AND token_hash = ?").bind(testId, tokenHash).first();
  return privateJson({ order: order ? orderPayload(order) : null });
});
