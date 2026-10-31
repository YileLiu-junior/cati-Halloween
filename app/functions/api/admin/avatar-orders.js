import { guarded, privateJson } from "../../lib/custom.js";
import { authorizeAdmin } from "../../lib/avatar-admin.js";
export const onRequestGet = ({ request, env }) => guarded(async () => {
  await authorizeAdmin(env, request);
  const { results: orders } = await env.PETI_DB.prepare("SELECT id,status,amount_fen,platform_order_no,paid_at,started_at,delivered_at,refund_status,error_code,attempts,created_at FROM orders ORDER BY created_at DESC LIMIT 50").all();
  const { results: refunds } = await env.PETI_DB.prepare("SELECT * FROM refund_requests ORDER BY created_at DESC LIMIT 50").all();
  const { results: attempts } = await env.PETI_DB.prepare("SELECT * FROM generation_attempts ORDER BY started_at DESC LIMIT 50").all();
  const { results: payments } = await env.PETI_DB.prepare("SELECT * FROM payment_inbox WHERE state!='verified' ORDER BY created_at DESC LIMIT 30").all();
  const { results: notifications } = await env.PETI_DB.prepare("SELECT id,order_id,event,state,attempts,error_code FROM avatar_notifications WHERE state IN ('uncertain','sending') LIMIT 30").all();
  const heartbeat = await env.PETI_DB.prepare("SELECT value,updated_at FROM delivery_control WHERE key='heartbeat'").first();
  const { results: transactions } = await env.PETI_DB.prepare("SELECT * FROM payment_transactions ORDER BY verified_at DESC LIMIT 100").all();
  const { results: audit } = await env.PETI_DB.prepare("SELECT * FROM avatar_audit ORDER BY created_at DESC LIMIT 50").all();
  return privateJson({ orders, refunds, attempts, payments, notifications, transactions, audit, heartbeatAt: heartbeat?.updated_at || null, deliveryActive: heartbeat?.value === "ok", testMode: env.PETI_TEST_MODE === "true" });
});
