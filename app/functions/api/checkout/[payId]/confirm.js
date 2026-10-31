import { fail, guarded, loadOrder, orderPayload, privateJson } from "../../../lib/custom.js";
import { confirmOrderPayment } from "../../../lib/payment.js";

export const onRequestPost = ({ request, env, params }) => guarded(async () => {
  if (env.PETI_TEST_MODE === "true") fail("TEST_PAYMENT_ONLY", "此环境不接收真实付款，由测试管理员模拟确认", 409);
  const { token, platformOrderNo } = await request.json();
  const order = await loadOrder(env, params.payId, token);
  await confirmOrderPayment(env, order, platformOrderNo);
  return privateJson(orderPayload(await loadOrder(env, order.id, token)));
});
