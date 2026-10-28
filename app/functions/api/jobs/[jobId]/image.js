import { fail, guarded, loadOrder, privateImage } from "../../../lib/custom.js";

export const onRequestGet = ({ request, env, params }) => guarded(async () => {
  const order = await loadOrder(env, params.jobId, request.headers.get("X-PT-Token"));
  if (order.expires_at <= Date.now()) {
    if (order.image_key) await env.PETI_IMAGES.delete(order.image_key);
    fail("IMAGE_EXPIRED", "定制图片已过 7 天保留期", 410);
  }
  if (order.status !== "ready") fail("IMAGE_NOT_READY", "定制图片还未生成完成", 409);
  const object = await env.PETI_IMAGES.get(order.image_key);
  if (!object) fail("IMAGE_EXPIRED", "定制图片已不可用，请联系作者", 410);
  return privateImage(object.body, "image/png");
});
