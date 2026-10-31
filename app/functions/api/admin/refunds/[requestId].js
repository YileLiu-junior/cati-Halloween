import { guarded, privateJson, readJson } from "../../../lib/custom.js";
import { authorizeAdmin } from "../../../lib/avatar-admin.js";
import { reviewRefund, refundPayload } from "../../../lib/refunds.js";
export const onRequestPost = ({ request, env, params }) => guarded(async () => {
  await authorizeAdmin(env, request);
  return privateJson(refundPayload(await reviewRefund(env, params.requestId, await readJson(request))));
});
