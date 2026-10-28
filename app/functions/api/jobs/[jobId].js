import { guarded, loadOrder, orderPayload, privateJson } from "../../lib/custom.js";

export const onRequestGet = ({ request, env, params }) => guarded(async () => {
  const order = await loadOrder(env, params.jobId, request.headers.get("X-PT-Token"));
  return privateJson(orderPayload(order));
});
