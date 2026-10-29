import { fail, guarded, privateJson, requireStorage } from "../../lib/custom.js";
import { confirmOrderPayment } from "../../lib/payment.js";

export const onRequestPost = ({ request, env }) => guarded(async () => {
  requireStorage(env);
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
  if (body?.data?.type !== "order" || typeof hint?.remark !== "string" || !/^[a-f0-9-]{36}$/.test(hint.remark.trim())) return privateJson({ ec: 200, em: "" });
  const order = await env.PETI_DB.prepare("SELECT * FROM orders WHERE id = ?").bind(hint.remark.trim()).first();
  if (!order) return privateJson({ ec: 200, em: "" });
  // 通知只提供查单线索，付款事实必须由持有创作者凭证的 API 二次确认。
  await confirmOrderPayment(env, order, hint.out_trade_no);
  return privateJson({ ec: 200, em: "" });
});
