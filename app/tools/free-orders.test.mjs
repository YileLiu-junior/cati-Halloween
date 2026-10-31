import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fixture, configured, post, newOrder, png, jpeg } from "./delivery-fixture.mjs";
import { GENERATION_CONFIG } from "../functions/lib/generation-config.js";
import { sha256Hex } from "../functions/lib/api.js";
import { browserKey, releaseFreeQuotaForAttempt } from "../functions/lib/free-quota.js";
import { onRequestPost as createFree, onRequestGet as getFree } from "../functions/api/free-orders.js";
import { onRequestPost as feedback } from "../functions/api/feedback.js";
import { onRequestGet as config } from "../functions/api/config.js";
import { onRequestPost as checkout } from "../functions/api/checkout.js";
import { onRequestPost as jobs } from "../functions/api/jobs.js";
import { onRequestPost as refundPost, onRequestGet as refundGet } from "../functions/api/refund-requests.js";
import { processGeneration } from "../functions/lib/generation-jobs.js";

const initial = structuredClone(GENERATION_CONFIG), originalFetch = globalThis.fetch;
afterEach(() => { Object.assign(GENERATION_CONFIG, structuredClone(initial)); globalThis.fetch = originalFetch; });

const generated = () => Response.json({ data: [{ b64_json: png.toString("base64") }] });

// 添加一份新的测评、照片与结果，用于模拟不同用户/不同次测评。
async function addTest(f, petType = "cat", roleId = "mummy") {
  const testId = crypto.randomUUID();
  const token = crypto.randomUUID().replaceAll("-", "");
  const tokenHash = await sha256Hex(token);
  const photoId = crypto.randomUUID();
  const result = { testId, petType, roleId, roleName: "木乃伊喵", petName: "测试", tokenHash, status: "completed" };
  f.kv.set(`session:${testId}`, JSON.stringify({ tokenHash }));
  f.kv.set(`result:${testId}`, JSON.stringify(result));
  const key = `photos/${photoId}.jpg`;
  f.db.prepare("INSERT INTO photos (id,test_id,token_hash,object_key,expires_at) VALUES (?,?,?,?,?)").run(photoId, testId, tokenHash, key, Date.now() + 86_400_000);
  await f.env.PETI_IMAGES.put(key, jpeg, { httpMetadata: { contentType: "image/jpeg" } });
  return { testId, token, photoId };
}

const create = (f, data) => post(createFree, f, { roleId: "mummy", ...data });

// 直接把订单置为已成功生成，沿用现有尝试表结构。
async function readyFreeOrder(f, browserId = crypto.randomUUID()) {
  const created = await (await create(f, { browserId })).json();
  const orderId = created.order.orderId;
  const attempt = crypto.randomUUID();
  f.db.prepare("UPDATE orders SET status='ready' WHERE id=?").run(orderId);
  f.db.prepare("UPDATE delivery_jobs SET state='succeeded',attempt_id=? WHERE order_id=?").run(attempt, orderId);
  f.db.prepare("INSERT INTO generation_attempts (id,order_id,state,stage,started_at,finished_at) VALUES (?,?,'ready','stored',?,?)").run(attempt, orderId, Date.now(), Date.now());
  return { orderId, attempt };
}

test("首次免费生成占用额度、创建免费订单并投递队列", async () => {
  const f = await fixture(); configured();
  const browserId = crypto.randomUUID();
  const res = await create(f, { browserId });
  assert.equal(res.status, 202);
  const body = await res.json();
  assert.equal(body.idempotent, false);
  assert.equal(body.order.free, true);
  assert.equal(body.order.amountFen, 0);
  assert.equal(body.order.orderId, body.order.payId);
  assert.equal(body.order.status, "queued");
  const order = f.db.prepare("SELECT * FROM orders WHERE id=?").get(body.order.orderId);
  assert.equal(order.amount_fen, 0);
  assert.equal(order.plan_id, "free");
  assert.equal(order.sku_id, "free");
  assert.equal(order.free_sequence, 1);
  assert.equal(order.free_quota_charged, 1);
  assert.equal(order.free_quota_refunded, 0);
  assert.equal(order.free_browser_key, await browserKey(browserId));
  const job = f.db.prepare("SELECT * FROM delivery_jobs WHERE order_id=?").get(order.id);
  assert.ok(job);
  assert.ok(["pending", "queued"].includes(job.state));
  assert.ok(f.messages.some((message) => message.type === "generate" && message.orderId === order.id));
  assert.equal(body.free.used, 1);
  assert.equal(body.free.remaining, 999);
  assert.equal(body.free.browserUsed, 1);
  assert.equal(body.free.browserRemaining, 1);
});

test("免费下单按 roleId 写入猫狗分角色 Prompt 快照", async () => {
  for (const petType of ["cat", "dog"]) {
    const f = await fixture(); configured();
    // 保留真实的 16 份角色 Prompt，只把参考图换成本地夹具。
    GENERATION_CONFIG.rolePrompts = structuredClone(initial.rolePrompts);
    if (petType === "dog") Object.assign(f, await addTest(f, "dog", "mummy"));
    const body = await (await create(f, { browserId: crypto.randomUUID() })).json();
    const order = f.db.prepare("SELECT * FROM orders WHERE id=?").get(body.order.orderId);
    const stored = JSON.parse(order.result_json);
    assert.equal(stored.petType, petType);
    assert.equal(stored.roleId, "mummy");
    assert.equal(stored.generation.prompt, initial.rolePrompts[petType].mummy);
    assert.equal(stored.generation.promptId, `${petType}:mummy`);
    assert.equal(stored.generation.referenceKey, petType === "cat" ? "references/style.png" : "references/dog-style.png");
  }
});

test("重复提交返回现有订单且不重复扣额度", async () => {
  const f = await fixture(); configured();
  const browserId = crypto.randomUUID();
  const first = await (await create(f, { browserId })).json();
  const res = await create(f, { browserId });
  assert.ok([200, 202].includes(res.status));
  const body = await res.json();
  assert.equal(body.idempotent, true);
  assert.equal(body.order.orderId, first.order.orderId);
  assert.equal(f.db.prepare("SELECT used FROM free_quota WHERE id=1").get().used, 1);
  assert.equal(f.db.prepare("SELECT used FROM free_usage").get().used, 1);
  assert.equal(f.db.prepare("SELECT count(*) n FROM free_requests").get().n, 1);
  assert.equal(f.db.prepare("SELECT count(*) n FROM orders").get().n, 1);
});

test("同一浏览器第三次生成被限且不占用全局额度", async () => {
  const f = await fixture(); configured();
  const browserId = crypto.randomUUID();
  const tests = [await addTest(f), await addTest(f), await addTest(f)];
  const call = (item) => create(f, { token: item.token, testId: item.testId, photoId: item.photoId, browserId });
  assert.equal((await call(tests[0])).status, 202);
  assert.equal((await call(tests[1])).status, 202);
  const third = await call(tests[2]);
  assert.ok([429, 409].includes(third.status));
  assert.equal((await third.json()).code, "FREE_BROWSER_LIMIT");
  assert.equal(f.db.prepare("SELECT used FROM free_usage WHERE browser_key=?").get(await browserKey(browserId)).used, 2);
  assert.equal(f.db.prepare("SELECT used FROM free_quota WHERE id=1").get().used, 2);
  assert.equal(f.db.prepare("SELECT count(*) n FROM orders").get().n, 2);
});

test("全局额度耗尽时第二笔被拒且浏览器额度同批退回", async () => {
  const f = await fixture(); configured();
  f.db.prepare("UPDATE free_quota SET total=1").run();
  const [first, second] = [await addTest(f), await addTest(f)];
  assert.equal((await create(f, { token: first.token, testId: first.testId, photoId: first.photoId, browserId: crypto.randomUUID() })).status, 202);
  const browserB = crypto.randomUUID();
  const res = await create(f, { token: second.token, testId: second.testId, photoId: second.photoId, browserId: browserB });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).code, "FREE_QUOTA_EXHAUSTED");
  assert.equal(f.db.prepare("SELECT used FROM free_quota WHERE id=1").get().used, 1);
  const usage = f.db.prepare("SELECT used FROM free_usage WHERE browser_key=?").get(await browserKey(browserB));
  assert.ok(!usage || usage.used === 0);
  assert.equal(f.db.prepare("SELECT count(*) n FROM orders").get().n, 1);
});

test("同一浏览器并发只成功一笔", async () => {
  const f = await fixture(); configured();
  f.db.prepare("UPDATE free_quota SET per_browser=1").run();
  const browserId = crypto.randomUUID();
  const [a, b] = [await addTest(f), await addTest(f)];
  const call = (item) => create(f, { token: item.token, testId: item.testId, photoId: item.photoId, browserId });
  const [first, second] = await Promise.all([call(a), call(b)]);
  assert.deepEqual([first.status, second.status].sort(), [202, 429]);
  assert.equal(f.db.prepare("SELECT used FROM free_quota WHERE id=1").get().used, 1);
  assert.equal(f.db.prepare("SELECT used FROM free_usage").get().used, 1);
  assert.equal(f.db.prepare("SELECT count(*) n FROM orders").get().n, 1);
});

test("重新生成复用原订单并递增序号、重新占用额度", async () => {
  const f = await fixture(); configured();
  const browserId = crypto.randomUUID();
  const first = await (await create(f, { browserId })).json();
  const orderId = first.order.orderId;
  const oldAttempt = crypto.randomUUID();
  f.db.prepare("UPDATE orders SET status='ready' WHERE id=?").run(orderId);
  f.db.prepare("UPDATE delivery_jobs SET state='succeeded',attempt_id=? WHERE order_id=?").run(oldAttempt, orderId);
  f.db.prepare("INSERT INTO generation_attempts (id,order_id,state,stage,started_at,finished_at) VALUES (?,?,'ready','stored',?,?)").run(oldAttempt, orderId, Date.now(), Date.now());
  const res = await create(f, { browserId, regenerate: true });
  assert.equal(res.status, 202);
  const body = await res.json();
  assert.equal(body.order.orderId, orderId);
  const order = f.db.prepare("SELECT * FROM orders WHERE id=?").get(orderId);
  assert.equal(order.free_sequence, 2);
  assert.equal(order.status, "queued");
  assert.equal(order.attempts, 0);
  assert.equal(order.image_key, null);
  assert.equal(order.free_quota_charged, 1);
  assert.equal(order.free_quota_refunded, 0);
  assert.equal(f.db.prepare("SELECT used FROM free_quota WHERE id=1").get().used, 2);
  assert.equal(f.db.prepare("SELECT used FROM free_usage").get().used, 2);
  assert.equal(f.db.prepare("SELECT count(*) n FROM orders").get().n, 1);
  const job = f.db.prepare("SELECT * FROM delivery_jobs WHERE order_id=?").get(orderId);
  assert.equal(job.state, "queued");
  assert.equal(job.attempt_id, null);
});

test("免费单失败退回额度，同一 attempt 不二次退回", async () => {
  const f = await fixture(); configured();
  const browserId = crypto.randomUUID();
  const created = await (await create(f, { browserId })).json();
  const orderId = created.order.orderId;
  globalThis.fetch = async () => new Response("provider down", { status: 500 });
  await processGeneration(f.env, orderId);
  const order = f.db.prepare("SELECT * FROM orders WHERE id=?").get(orderId);
  assert.equal(order.status, "failed");
  assert.equal(order.retryable, 0);
  assert.equal(order.free_quota_refunded, 1);
  assert.equal(f.db.prepare("SELECT used FROM free_quota WHERE id=1").get().used, 0);
  assert.equal(f.db.prepare("SELECT used FROM free_usage WHERE browser_key=?").get(await browserKey(browserId)).used, 0);
  const attemptId = f.db.prepare("SELECT attempt_id FROM delivery_jobs WHERE order_id=?").get(orderId).attempt_id;
  assert.equal(f.db.prepare("SELECT applied FROM free_quota_refunds WHERE attempt_id=?").get(attemptId).applied, 1);
  await releaseFreeQuotaForAttempt(f.env, attemptId, orderId);
  assert.equal(f.db.prepare("SELECT used FROM free_quota WHERE id=1").get().used, 0);
  assert.equal(f.db.prepare("SELECT count(*) n FROM free_quota_refunds").get().n, 1);
  assert.equal(f.db.prepare("SELECT count(*) n FROM avatar_notifications").get().n, 0);
});

test("免费单可重试失败也退回一次，regenerate 后净额不变且不二次退", async () => {
  const f = await fixture(); configured();
  const browserId = crypto.randomUUID();
  const created = await (await create(f, { browserId })).json();
  const orderId = created.order.orderId;
  const before = f.db.prepare("SELECT used FROM free_quota WHERE id=1").get().used;
  assert.equal(before, 1);
  // 首次 429 明确未产出图片：虽然标记为可手动重试，也先退回额度。
  globalThis.fetch = async () => new Response("quota", { status: 429 });
  await processGeneration(f.env, orderId);
  let order = f.db.prepare("SELECT * FROM orders WHERE id=?").get(orderId);
  assert.equal(order.status, "failed");
  assert.equal(order.retryable, 1);
  assert.equal(order.free_quota_refunded, 1);
  assert.equal(f.db.prepare("SELECT used FROM free_quota WHERE id=1").get().used, 0);
  assert.equal(f.db.prepare("SELECT used FROM free_usage WHERE browser_key=?").get(await browserKey(browserId)).used, 0);
  const attemptId = f.db.prepare("SELECT attempt_id FROM delivery_jobs WHERE order_id=?").get(orderId).attempt_id;
  assert.equal(f.db.prepare("SELECT applied FROM free_quota_refunds WHERE attempt_id=?").get(attemptId).applied, 1);
  // 免费单重试走 regenerate：重新占一次额度，净额回到失败前。
  const res = await create(f, { browserId, regenerate: true });
  assert.equal(res.status, 202);
  order = f.db.prepare("SELECT * FROM orders WHERE id=?").get(orderId);
  assert.equal(order.free_sequence, 2);
  assert.equal(order.free_quota_refunded, 0);
  assert.equal(f.db.prepare("SELECT used FROM free_quota WHERE id=1").get().used, before);
  assert.equal(f.db.prepare("SELECT used FROM free_usage WHERE browser_key=?").get(await browserKey(browserId)).used, before);
  // 旧 attempt 的退款台账已处理，不会二次扣回。
  await releaseFreeQuotaForAttempt(f.env, attemptId, orderId);
  assert.equal(f.db.prepare("SELECT used FROM free_quota WHERE id=1").get().used, before);
  assert.equal(f.db.prepare("SELECT count(*) n FROM free_quota_refunds").get().n, 1);
});

test("免费单成功后额度保留且不写私信提醒", async () => {
  const f = await fixture(); configured();
  const created = await (await create(f, { browserId: crypto.randomUUID() })).json();
  globalThis.fetch = async () => generated();
  await processGeneration(f.env, created.order.orderId);
  const order = f.db.prepare("SELECT * FROM orders WHERE id=?").get(created.order.orderId);
  assert.equal(order.status, "ready");
  assert.equal(order.free_quota_refunded, 0);
  assert.equal(f.db.prepare("SELECT used FROM free_quota WHERE id=1").get().used, 1);
  assert.equal(f.db.prepare("SELECT count(*) n FROM free_quota_refunds").get().n, 0);
  assert.equal(f.db.prepare("SELECT count(*) n FROM avatar_notifications").get().n, 0);
});

test("付费单失败不触碰免费计数", async () => {
  const f = await fixture(); configured();
  const paid = await newOrder(f);
  f.db.prepare("UPDATE orders SET status='unlocked' WHERE id=?").run(paid.payId);
  f.db.prepare("INSERT INTO delivery_jobs (order_id,updated_at) VALUES (?,?)").run(paid.payId, Date.now());
  globalThis.fetch = async () => new Response("provider down", { status: 500 });
  await processGeneration(f.env, paid.payId);
  assert.equal(f.db.prepare("SELECT status FROM orders WHERE id=?").get(paid.payId).status, "failed");
  assert.equal(f.db.prepare("SELECT used FROM free_quota WHERE id=1").get().used, 0);
  assert.equal(f.db.prepare("SELECT count(*) n FROM free_usage").get().n, 0);
  assert.equal(f.db.prepare("SELECT count(*) n FROM free_quota_refunds").get().n, 0);
});

test("免费单不能走付费重试或退款接口", async () => {
  const f = await fixture(); configured();
  const created = await (await create(f, { browserId: crypto.randomUUID() })).json();
  const orderId = created.order.orderId;
  const jobsRes = await post(jobs, f, { payId: orderId });
  assert.equal(jobsRes.status, 409);
  assert.equal((await jobsRes.json()).code, "FREE_ORDER_MANAGED");
  const refundRes = await post(refundPost, f, { payId: orderId, reason: "not_delivered" });
  assert.equal(refundRes.status, 409);
  assert.equal((await refundRes.json()).code, "NOT_REFUNDABLE");
  const getRes = await refundGet({ env: f.env, request: new Request(`https://pet.test/api/refund-requests?payId=${orderId}`, { headers: { "X-PT-Token": f.token } }) });
  assert.equal(getRes.status, 409);
  assert.equal((await getRes.json()).code, "NOT_REFUNDABLE");
});

test("付款开关关闭时下单接口返回 503", async () => {
  const f = await fixture(); configured();
  for (const value of ["false", undefined]) {
    if (value === undefined) delete f.env.PAYMENT_ENABLED; else f.env.PAYMENT_ENABLED = value;
    const res = await post(checkout, f, {});
    assert.equal(res.status, 503);
    assert.equal((await res.json()).code, "PAYMENT_DISABLED");
  }
  assert.equal(f.db.prepare("SELECT count(*) n FROM orders").get().n, 0);
});

test("没有爱发电配置时免费服务仍可用", async () => {
  const f = await fixture(); configured();
  for (const key of ["AFDIAN_USER_ID", "AFDIAN_API_TOKEN", "AFDIAN_PLAN_ID", "AFDIAN_SKU_ID", "AFDIAN_PAY_URL"]) delete f.env[key];
  f.env.PAYMENT_ENABLED = "false";
  const browserId = crypto.randomUUID();
  const res = await config({ env: f.env, request: new Request(`https://pet.test/api/config?browserId=${browserId}`) });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.available, true);
  assert.equal(body.paymentAvailable, false);
  assert.equal(body.tipUrl, null);
  assert.equal(body.free.enabled, true);
  assert.equal(body.free.total, 1000);
  assert.equal(body.free.perBrowser, 2);
  assert.equal(body.free.used, 0);
  assert.equal(body.free.browserUsed, 0);
  assert.equal(body.free.reason, null);
});

test("tipUrl 只接受爱发电官方下单页", async () => {
  const f = await fixture(); configured();
  f.env.AFDIAN_SUPPORT_URL = "https://afdian.com/order/create?plan_id=plan";
  let body = await (await config({ env: f.env, request: new Request("https://pet.test/api/config") })).json();
  assert.equal(body.tipUrl, "https://afdian.com/order/create?plan_id=plan");
  f.env.AFDIAN_SUPPORT_URL = "https://evil.example/order/create";
  body = await (await config({ env: f.env, request: new Request("https://pet.test/api/config") })).json();
  assert.equal(body.tipUrl, null);
});

test("反馈正常提交并保持幂等", async () => {
  const f = await fixture(); configured();
  const { orderId, attempt } = await readyFreeOrder(f);
  const send = (data) => post(feedback, f, { orderId, attemptId: attempt, ...data });
  let res = await send({ satisfaction: 3, similarity: 2, priceBand: "3-5", spendHistory: 1 });
  assert.equal(res.status, 200);
  let body = await res.json();
  assert.equal(body.feedback.satisfaction, 3);
  assert.equal(body.feedback.satisfied, true);
  assert.equal(body.feedback.similarity, 2);
  assert.equal(body.feedback.priceBand, "3-5");
  assert.equal(body.feedback.spendHistory, 1);
  assert.equal(body.feedback.priceAnswered, true);
  // 换到不满意分支时，相似度和价格会被清掉，原因写进 issue。
  res = await send({ satisfaction: 1, issue: "style", spendHistory: 1 });
  assert.equal(res.status, 200);
  body = await res.json();
  assert.equal(body.feedback.satisfaction, 1);
  assert.equal(body.feedback.satisfied, false);
  assert.equal(body.feedback.issue, "style");
  assert.equal(body.feedback.similarity, null);
  assert.equal(body.feedback.priceBand, null);
  assert.equal(f.db.prepare("SELECT count(*) n FROM free_feedback").get().n, 1);
});

test("旧客户端只发 satisfied / priceFen 仍能写入", async () => {
  const f = await fixture(); configured();
  const { orderId, attempt } = await readyFreeOrder(f);
  const res = await post(feedback, f, { orderId, attemptId: attempt, satisfied: true, priceFen: 200 });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.feedback.satisfaction, 3);
  assert.equal(body.feedback.priceFen, 200);
  assert.equal(body.feedback.priceAnswered, true);
});

test("反馈拒绝非法价格和过期 attempt", async () => {
  const f = await fixture(); configured();
  const { orderId, attempt } = await readyFreeOrder(f);
  let res = await post(feedback, f, { orderId, attemptId: attempt, satisfied: true, priceFen: 300 });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, "PRICE_INVALID");
  res = await post(feedback, f, { orderId, attemptId: attempt, satisfaction: 2, priceBand: "99" });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, "PRICE_INVALID");
  res = await post(feedback, f, { orderId, attemptId: attempt, satisfaction: 2, similarity: 5 });
  assert.equal(res.status, 400);
  res = await post(feedback, f, { orderId, attemptId: attempt, satisfaction: 1, issue: "unknown" });
  assert.equal(res.status, 400);
  res = await post(feedback, f, { orderId, attemptId: crypto.randomUUID(), satisfied: true, priceFen: 100 });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).code, "FEEDBACK_STALE");
  res = await post(feedback, f, { orderId, attemptId: attempt, satisfied: "yes" });
  assert.equal(res.status, 400);
});

test("额度耗尽后查看接口仍返回订单和反馈", async () => {
  const f = await fixture(); configured();
  const browserId = crypto.randomUUID();
  const { orderId, attempt } = await readyFreeOrder(f, browserId);
  f.db.prepare("UPDATE free_quota SET used=total").run();
  assert.equal((await post(feedback, f, { orderId, attemptId: attempt, satisfied: true, priceFen: 100 })).status, 200);
  const res = await getFree({ env: f.env, request: new Request(`https://pet.test/api/free-orders?testId=${f.testId}&browserId=${browserId}`, { headers: { "X-PT-Token": f.token } }) });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.order.orderId, orderId);
  assert.equal(body.order.status, "ready");
  assert.equal(body.order.attemptId, attempt);
  assert.equal(body.feedback.priceFen, 100);
  assert.equal(body.free.exhausted, true);
  assert.equal(body.free.reason, "QUOTA_EXHAUSTED");
});
