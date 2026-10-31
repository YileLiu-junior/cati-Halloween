import { fail, guarded, loadOrder, privateImage } from "../../../lib/custom.js";
import { imageWithheld } from "../../../lib/delivery-store.js";
import { previewJpeg } from "../../../lib/preview-image.js";

const PREVIEW_CACHE = "private, max-age=86400";

export const onRequestGet = ({ request, env, params }) => guarded(async () => {
  const order = await loadOrder(env, params.jobId, request.headers.get("X-PT-Token"));
  if (imageWithheld(order)) fail("REFUND_LOCKED", "这笔订单已进入退款处理", 409);
  if (order.expires_at <= Date.now()) {
    if (order.image_key) {
      await Promise.all([
        env.PETI_IMAGES.delete(order.image_key),
        env.PETI_IMAGES.delete(`${order.image_key}.preview.jpg`),
      ]);
    }
    fail("IMAGE_EXPIRED", "定制图片已过 7 天保留期", 410);
  }
  if (order.status !== "ready") fail("IMAGE_NOT_READY", "定制图片还未生成完成", 409);
  // ?preview=1：展示用小图，首次生成后缓存在 R2；不带参数时仍返回高清原图。
  if (new URL(request.url).searchParams.get("preview") === "1") {
    const previewKey = `${order.image_key}.preview.jpg`;
    const cached = await env.PETI_IMAGES.get(previewKey);
    if (cached) return privateImage(cached.body, "image/jpeg", PREVIEW_CACHE);
    const source = await env.PETI_IMAGES.get(order.image_key);
    if (!source) fail("IMAGE_EXPIRED", "定制图片已不可用，请联系作者", 410);
    const bytes = await source.arrayBuffer();
    try {
      const encoded = previewJpeg(bytes);
      await env.PETI_IMAGES.put(previewKey, encoded, { httpMetadata: { contentType: "image/jpeg" } });
      return privateImage(encoded, "image/jpeg", PREVIEW_CACHE);
    } catch {
      // 缩略图处理失败时退回原图，不影响查看。
      return privateImage(bytes, source.httpMetadata?.contentType || "image/png");
    }
  }
  const object = await env.PETI_IMAGES.get(order.image_key);
  if (!object) fail("IMAGE_EXPIRED", "定制图片已不可用，请联系作者", 410);
  return privateImage(object.body, object.httpMetadata?.contentType || "image/png");
});
