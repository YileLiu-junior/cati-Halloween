import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { onRequestPost as upload } from "../functions/api/photos.js";
import { onRequestPost as checkout } from "../functions/api/checkout.js";
import { onRequestPost as confirm } from "../functions/api/checkout/[payId]/confirm.js";
import { onRequestPost as generate } from "../functions/api/jobs.js";
import { onRequestGet as image } from "../functions/api/jobs/[jobId]/image.js";
import { onRequestGet as status } from "../functions/api/jobs/[jobId].js";
import { sha256Hex } from "../functions/lib/api.js";
import { amountFen, CUTOFF, jpegDimensions } from "../functions/lib/custom.js";
import { GENERATION_CONFIG } from "../functions/lib/generation-config.js";
import { afdianSignature, moneyFen } from "../functions/lib/payment.js";

const originalFetch = globalThis.fetch;
const emptyConfig = structuredClone(GENERATION_CONFIG);
afterEach(() => { Object.assign(GENERATION_CONFIG, structuredClone(emptyConfig)); globalThis.fetch = originalFetch; });
const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const jpeg = Uint8Array.from([255, 216, 255, 192, 0, 17, 8, 2, 0, 2, 0, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0, 255, 217]);

async function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../migrations/0001_custom_orders.sql", import.meta.url), "utf8"));
  const objects = new Map(), kv = new Map();
  const env = {
    PETI_DB: { prepare(sql) { return { bind(...args) { return {
      async first() { return db.prepare(sql).get(...args) || null; },
      async run() { return { meta: { changes: db.prepare(sql).run(...args).changes } }; },
    }; } }; } },
    PETI_KV: { get: async (key) => kv.get(key) || null },
    PETI_IMAGES: {
      async put(key, body, meta) { objects.set(key, { bytes: new Uint8Array(body), ...meta }); },
      async get(key) {
        const object = objects.get(key);
        return object ? { ...object, size: object.bytes.length, body: object.bytes, arrayBuffer: async () => object.bytes.buffer } : null;
      },
      async head(key) { return this.get(key); },
      async delete(key) { objects.delete(key); },
    },
    OPENAI_API_KEY: "test-key", AFDIAN_USER_ID: "creator", AFDIAN_API_TOKEN: "test-token", AFDIAN_PLAN_ID: "plan", AFDIAN_PAY_URL: "https://afdian.com/order/create?plan_id=plan",
  };
  const testId = crypto.randomUUID(), token = crypto.randomUUID().replaceAll("-", ""), tokenHash = await sha256Hex(token);
  const result = { testId, petType: "cat", roleId: "mummy", petName: "馒头", tokenHash, status: "completed" };
  kv.set(`session:${testId}`, JSON.stringify({ tokenHash })); kv.set(`result:${testId}`, JSON.stringify(result));
  const photoId = crypto.randomUUID(), expires = Date.now() + 86_400_000;
  db.prepare("INSERT INTO photos VALUES (?, ?, ?, ?, ?)").run(photoId, testId, tokenHash, "photos/pet.jpg", expires);
  await env.PETI_IMAGES.put("photos/pet.jpg", jpeg, { httpMetadata: { contentType: "image/jpeg" } });
  await env.PETI_IMAGES.put("references/style.png", png, { httpMetadata: { contentType: "image/png" } });
  return { db, env, testId, token, photoId, objects };
}
function configured() { GENERATION_CONFIG.prompt = "{petType} / {roleId} / {petName}"; GENERATION_CONFIG.referenceImageKeys = ["references/style.png"]; }
function post(handler, fixture, data, params = {}) {
  return handler({ env: fixture.env, params, request: new Request("https://pet.test/api", {
    method: "POST", headers: data instanceof FormData ? { "CF-Connecting-IP": fixture.testId } : { "content-type": "application/json" }, body: data instanceof FormData ? data : JSON.stringify({ token: fixture.token, testId: fixture.testId, photoId: fixture.photoId, ...data }),
  }) });
}
async function newOrder(f) { configured(); return (await post(checkout, f, {})).json(); }
function paidResponse(order, overrides = {}) {
  return Response.json({ ec: 200, data: { list: [{ out_trade_no: "2026102800000001", status: 2, plan_id: "plan", total_amount: (order.amountFen / 100).toFixed(2), remark: order.payId, ...overrides }] } });
}

test("价格按北京时间截止点切换，金额解析不使用浮点四舍五入，签名匹配官方示例", () => {
  assert.equal(amountFen(CUTOFF - 1), 200); assert.equal(amountFen(CUTOFF), 590);
  assert.equal(moneyFen("2.00"), 200); assert.equal(moneyFen("5.90"), 590);
  for (const value of ["2.001", "2", "-2.00", 2, "NaN"]) assert.equal(moneyFen(value), null);
  assert.equal(afdianSignature("123", '{"a":333}', 1624339905, "abc"), "a4acc28b81598b7e5d84ebdc3e91710c");
});
test("空配置、缺参考图、错误照片和伪造凭证均不能创建收费订单", async () => {
  const f = await setup();
  assert.equal((await post(checkout, f, {})).status, 503);
  configured(); f.objects.delete("references/style.png");
  assert.equal((await post(checkout, f, {})).status, 503);
  assert.equal((await post(checkout, f, { token: "0".repeat(32) })).status, 401);
  assert.equal((await post(checkout, f, { photoId: "missing" })).status, 400);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM orders").get().n, 0);
});
test("上传必须同意用途，复验 JPEG 签名与尺寸，照片私有保存", async () => {
  const f = await setup();
  const form = new FormData();
  form.set("token", f.token); form.set("testId", f.testId); form.set("photo", new Blob([jpeg], { type: "image/jpeg" }), "pet.jpg");
  assert.equal((await post(upload, f, form)).status, 400);
  form.set("consent", "true");
  const response = await post(upload, f, form);
  assert.equal(response.status, 201);
  const body = await response.json(); assert.ok(body.photoId); assert.equal(body.imageUrl, undefined);
  assert.equal(jpegDimensions(new TextEncoder().encode("fake")), null);
  assert.equal(jpegDimensions(Uint8Array.from([255, 216, 255, 255, 255, 217])), null);
  assert.deepEqual(jpegDimensions(jpeg), { width: 512, height: 512 });
});
test("并发 checkout 只建一笔订单，前端不能改金额，未付订单不能生图", async () => {
  const f = await setup(); configured();
  const orders = await Promise.all([post(checkout, f, { amountFen: 1 }), post(checkout, f, {})]);
  const [a, b] = await Promise.all(orders.map((r) => r.json()));
  assert.equal(a.payId, b.payId); assert.equal(a.amountFen, amountFen());
  assert.equal((await post(generate, f, { payId: a.payId })).status, 402);
});
test("后端查单核验金额、方案、付款状态和留言，不信任客户端已付款字段", async () => {
  const f = await setup(), order = await newOrder(f);
  let response = paidResponse(order, { total_amount: "0.01" });
  globalThis.fetch = async () => response;
  assert.equal((await post(confirm, f, { platformOrderNo: "2026102800000001", paid: true }, { payId: order.payId })).status, 409);
  assert.equal(f.db.prepare("SELECT status FROM orders").get().status, "unpaid");
  for (const overrides of [{ plan_id: "wrong" }, { status: 0 }, { remark: "other-order" }, {}]) {
    f.db.prepare("UPDATE payment_gate SET next_check_at = 0").run(); response = paidResponse(order, overrides);
    const verified = await post(confirm, f, { platformOrderNo: "2026102800000001" }, { payId: order.payId });
    assert.equal(verified.status, Object.keys(overrides).length ? 409 : 200);
  }
  globalThis.fetch = () => { throw new Error("must not query provider twice"); };
  assert.equal((await post(confirm, f, {}, { payId: order.payId })).status, 200);
  assert.equal(f.db.prepare("SELECT status FROM orders").get().status, "unlocked");
});
test("平台订单号由唯一约束保护，不能被两笔定制认领", async () => {
  const f = await setup(), order = await newOrder(f);
  f.db.prepare("UPDATE orders SET platform_order_no = '2026102800000001', test_id = 'other'").run();
  const second = await (await post(checkout, f, {})).json();
  globalThis.fetch = async () => paidResponse(second);
  assert.equal((await post(confirm, f, { platformOrderNo: "2026102800000001" }, { payId: second.payId })).status, 409);
  assert.equal(f.db.prepare("SELECT status FROM orders WHERE id = ?").get(second.payId).status, "unpaid");
});
test("照片和参考图按顺序打包，并发生成只调用一次，成品需要鉴权", async () => {
  const f = await setup(), order = await newOrder(f);
  f.db.prepare("UPDATE orders SET status = 'unlocked'").run();
  let calls = 0, release;
  const gate = new Promise((resolve) => { release = resolve; });
  globalThis.fetch = async (url, options) => {
    calls++; assert.equal(url, "https://api.openai.com/v1/images/edits");
    assert.equal(options.headers.authorization, "Bearer test-key");
    assert.equal(options.body.get("model"), "gpt-image-2");
    assert.equal(options.body.get("prompt"), "cat / mummy / 馒头");
    assert.deepEqual(options.body.getAll("image[]").map((file) => file.name), ["pet.jpg", "reference-0.png"]);
    await gate; return Response.json({ data: [{ b64_json: btoa(String.fromCharCode(...png)) }] });
  };
  const first = post(generate, f, { payId: order.payId });
  while (!calls) await new Promise((resolve) => setTimeout(resolve, 1));
  const second = await post(generate, f, { payId: order.payId });
  assert.equal((await second.json()).status, "generating"); release();
  assert.equal((await (await first).json()).status, "ready");
  assert.equal(calls, 1); assert.equal(f.db.prepare("SELECT attempts FROM orders").get().attempts, 1);
  const params = { jobId: order.payId };
  assert.equal((await image({ env: f.env, params, request: new Request("https://pet.test") })).status, 401);
  const downloaded = await image({ env: f.env, params, request: new Request("https://pet.test", { headers: { "X-PT-Token": f.token } }) });
  assert.equal(downloaded.status, 200); assert.match(downloaded.headers.get("cache-control"), /no-store/);
  f.db.prepare("UPDATE orders SET expires_at = 0").run();
  assert.equal((await image({ env: f.env, params, request: new Request("https://pet.test", { headers: { "X-PT-Token": f.token } }) })).status, 410);
});
test("生成超时不重复调用；明确故障最多允许两次，保留付款", async () => {
  const f = await setup(), order = await newOrder(f);
  f.db.prepare("UPDATE orders SET status = 'unlocked'").run();
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("timeout"); };
  assert.equal((await (await post(generate, f, { payId: order.payId })).json()).status, "uncertain");
  await post(generate, f, { payId: order.payId }); assert.equal(calls, 1);
  f.db.prepare("UPDATE orders SET status = 'unlocked', attempts = 0").run();
  globalThis.fetch = async () => { calls++; return new Response("unavailable", { status: 503 }); };
  await post(generate, f, { payId: order.payId }); await post(generate, f, { payId: order.payId });
  assert.equal((await post(generate, f, { payId: order.payId })).status, 402);
  assert.equal(f.db.prepare("SELECT attempts FROM orders").get().attempts, 2);
  f.db.prepare("UPDATE orders SET status = 'generating', started_at = 0").run();
  const resumed = await status({ env: f.env, params: { jobId: order.payId }, request: new Request("https://pet.test", { headers: { "X-PT-Token": f.token } }) });
  assert.equal((await resumed.json()).status, "uncertain");
});
