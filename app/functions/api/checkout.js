import { authorize, amountFen, fail, guarded, orderPayload, paymentConfigured, privateJson, readPhoto, requireGeneration, requireStorage } from "../lib/custom.js";
import { generationProfile, generationSnapshot } from "../lib/generation-config.js";

export const onRequestPost = ({ request, env }) => guarded(async () => {
  requireStorage(env);
  const { token, testId, photoId, roleId } = await request.json();
  const { tokenHash, result } = await authorize(env, testId, token);
  if (roleId !== undefined && (typeof roleId !== "string" || !Object.hasOwn(generationProfile(result.petType)?.roleImageKeys || {}, roleId))) fail("ROLE_INVALID", "请选择有效的角色");
  const selectedResult = { ...result, testRoleId: result.roleId, roleId: roleId ?? result.roleId };
  selectedResult.generation = generationSnapshot(selectedResult);
  const photo = await readPhoto(env, photoId, tokenHash);
  if (photo.test_id !== testId) fail("PHOTO_INVALID", "照片不属于这份测评");
  await requireGeneration(env, selectedResult);
  const testMode = env.PETI_TEST_MODE === "true";
  if (!testMode && !paymentConfigured(env)) fail("SERVICE_NOT_CONFIGURED", "支付尚未开放，暂不收款", 503);
  await env.PETI_DB.prepare("INSERT OR IGNORE INTO orders (id, test_id, token_hash, photo_id, amount_fen, plan_id, sku_id, result_json, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), testId, tokenHash, photoId, amountFen(), env.AFDIAN_PLAN_ID, env.AFDIAN_SKU_ID, JSON.stringify(selectedResult), Date.now(), photo.expires_at).run();
  const order = await env.PETI_DB.prepare("SELECT * FROM orders WHERE test_id = ?").bind(testId).first();
  if (order.status === "unpaid" && order.photo_id !== photoId) fail("ORDER_PHOTO_CHANGED", "这份测评已有待付款订单，已锁定原照片。请回到原订单，或重新测评后使用新照片", 409);
  if (order.status === "unpaid" && JSON.parse(order.result_json).roleId !== selectedResult.roleId) fail("ORDER_ROLE_CHANGED", "这份结果已有待付款订单，角色不能更改，请联系作者处理", 409);
  if (order.status === "unpaid" && order.amount_fen !== amountFen()) fail("PAY_ID_STALE", "原订单报价已过期，请联系作者核对，暂勿付款", 409);
  if (order.status === "unpaid" && (order.plan_id !== env.AFDIAN_PLAN_ID || order.sku_id !== env.AFDIAN_SKU_ID)) fail("ORDER_PRODUCT_CHANGED", "原订单对应的商品型号已变更，请联系作者处理，暂勿付款", 409);
  const payUrl = testMode ? null : new URL(env.AFDIAN_PAY_URL);
  payUrl?.searchParams.set("remark", order.id);
  payUrl?.searchParams.set("custom_order_id", order.id);
  return privateJson({ ...orderPayload(order), payUrl: payUrl?.href || null, paymentReference: order.id, testMode });
});

export const onRequestGet = ({ request, env }) => guarded(async () => {
  requireStorage(env);
  const testId = new URL(request.url).searchParams.get("testId");
  const { tokenHash } = await authorize(env, testId, request.headers.get("X-PT-Token"));
  const order = await env.PETI_DB.prepare("SELECT * FROM orders WHERE test_id = ? AND token_hash = ?").bind(testId, tokenHash).first();
  return privateJson({ order: order ? orderPayload(order) : null });
});
