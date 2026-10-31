import { guarded, loadOrder, orderPayload, privateJson } from "../../lib/custom.js";

export const onRequestGet = ({ request, env, params }) => guarded(async () => {
  const order = await loadOrder(env, params.payId, request.headers.get("X-PT-Token"));
  return privateJson({ ...orderPayload(order), testMode: env.PETI_TEST_MODE === "true" });
});
