import { buildImageRequest, generateImage } from "../lib/generate.js";
import { fail, guarded, loadOrder, orderPayload, privateJson, readPhoto, requireGeneration } from "../lib/custom.js";

export const onRequestPost = ({ request, env }) => guarded(async () => {
  const { token, payId } = await request.json();
  let order = await loadOrder(env, payId, token);
  if (["generating", "ready", "uncertain"].includes(order.status)) return privateJson(orderPayload(order));
  if (order.status !== "unlocked" && !(order.status === "failed" && order.retryable && order.attempts < 2)) fail("NOT_UNLOCKED", "订单尚未确认付款，或已用完生成次数", 402);
  await requireGeneration(env);
  const photo = await readPhoto(env, order.photo_id, order.token_hash);
  const result = JSON.parse(order.result_json);
  const form = await buildImageRequest(env, result, photo);
  // D1 条件更新只允许一个请求领取调用权，刷新、双击和并发标签不会重复扣次。
  const claim = await env.PETI_DB.prepare("UPDATE orders SET status = 'generating', attempts = attempts + 1, retryable = 0, error_code = NULL, started_at = ? WHERE id = ? AND attempts < 2 AND (status = 'unlocked' OR (status = 'failed' AND retryable = 1))")
    .bind(Date.now(), order.id).run();
  if (!claim.meta.changes) return privateJson(orderPayload(await loadOrder(env, order.id, token)));
  // shortcut: 本版同步等待生成，需要关页后继续时改用持久队列。
  const generated = await generateImage(env, form);
  if (generated.status === "ready") {
    const key = `jobs/${order.id}/result.png`;
    try {
      await env.PETI_IMAGES.put(key, generated.image, { httpMetadata: { contentType: "image/png" } });
      await env.PETI_DB.prepare("UPDATE orders SET status = 'ready', image_key = ?, error_code = NULL WHERE id = ? AND status IN ('generating', 'uncertain')").bind(key, order.id).run();
    } catch {
      await env.PETI_DB.prepare("UPDATE orders SET status = 'uncertain', error_code = 'STORAGE_UNCERTAIN', retryable = 0 WHERE id = ? AND status = 'generating'").bind(order.id).run();
    }
  } else {
    await env.PETI_DB.prepare("UPDATE orders SET status = ?, retryable = ?, error_code = ? WHERE id = ? AND status IN ('generating', 'uncertain')")
      .bind(generated.status, generated.retryable ? 1 : 0, generated.errorCode, order.id).run();
  }
  order = await loadOrder(env, order.id, token);
  return privateJson(orderPayload(order));
});
