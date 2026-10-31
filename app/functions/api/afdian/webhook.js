import { fail, guarded, privateJson, requireStorage } from "../../lib/custom.js";
import { persistPaymentEvent, paymentOrderId } from "../../lib/payment.js";
import { clientIp, rateLimit } from "../../lib/api.js";

export const onRequestPost = ({ request, env }) => guarded(async () => {
  if (env.PETI_TEST_MODE === "true") return privateJson({ ec: 200, em: "preview ignores real payments" });
  requireStorage(env);
  if (!rateLimit(`payment-webhook:${clientIp(request)}`, 120)) fail("RATE_LIMITED", "通知过于频繁", 429, true);
  if (Number(request.headers.get("content-length")) > 16_384) fail("PARAM_INVALID", "通知过大", 413);
  const reader = request.body?.getReader();
  const chunks = [];
  let length = 0;
  while (reader) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 16_384) { await reader.cancel(); fail("PARAM_INVALID", "通知过大", 413); }
    chunks.push(value);
  }
  const body = await new Response(new Blob(chunks)).json().catch(() => null);
  const hint = body?.data?.order;
  const hintId = hint && paymentOrderId(hint);
  if (body?.data?.type !== "order" || !hintId) return privateJson({ ec: 200, em: "" });
  const order = await env.PETI_DB.prepare("SELECT id FROM orders WHERE id = ?").bind(hintId).first();
  if (!order) return privateJson({ ec: 200, em: "" });
  // 先持久收件再确认接收；后台查单使用权威响应重新认单，不信任通知关联码。
  await persistPaymentEvent(env, hint.out_trade_no);
  return privateJson({ ec: 200, em: "" });
});
