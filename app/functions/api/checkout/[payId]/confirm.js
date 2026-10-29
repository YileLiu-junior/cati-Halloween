import { guarded, loadOrder, orderPayload, privateJson } from "../../../lib/custom.js";
import { confirmOrderPayment } from "../../../lib/payment.js";

export const onRequestPost = ({ request, env, params }) => guarded(async () => {
  const { token, platformOrderNo } = await request.json();
  const order = await loadOrder(env, params.payId, token);
  await confirmOrderPayment(env, order, platformOrderNo);
  return privateJson(orderPayload(await loadOrder(env, order.id, token)));
});
