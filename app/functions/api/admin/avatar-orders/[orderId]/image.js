import { fail, guarded, privateImage } from "../../../../lib/custom.js";
import { authorizeAdmin } from "../../../../lib/avatar-admin.js";
export const onRequestGet = ({ request, env, params }) => guarded(async () => {
  await authorizeAdmin(env, request);
  const order = await env.PETI_DB.prepare("SELECT * FROM orders WHERE id=?").bind(params.orderId).first();
  if (!order) fail("NOT_FOUND", "订单不存在", 404);
  const type = new URL(request.url).searchParams.get("type");
  let key = order.image_key;
  if (type === "source") key = (await env.PETI_DB.prepare("SELECT object_key FROM photos WHERE id=?").bind(order.photo_id).first())?.object_key;
  else if (type !== "result") fail("PARAM_MISSING", "请选择图片类型");
  else if (!key) key = (await env.PETI_DB.prepare("SELECT image_key FROM generation_attempts WHERE order_id=? AND state='ready' ORDER BY started_at DESC LIMIT 1").bind(order.id).first())?.image_key;
  if (!key) fail("NOT_FOUND", "暂无图片", 404);
  const object = await env.PETI_IMAGES.get(key);
  if (!object) fail("NOT_FOUND", "暂无图片或已过保留期", 404);
  return privateImage(object.body, object.httpMetadata?.contentType || "image/png");
});
