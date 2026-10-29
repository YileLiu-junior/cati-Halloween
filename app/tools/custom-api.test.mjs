import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { onRequestPost as upload } from "../functions/api/photos.js";
import { onRequestPost as checkout } from "../functions/api/checkout.js";
import { onRequestPost as confirm } from "../functions/api/checkout/[payId]/confirm.js";
import { onRequestPost as generate } from "../functions/api/jobs.js";
import { onRequestGet as image } from "../functions/api/jobs/[jobId]/image.js";
import { onRequestGet as status } from "../functions/api/jobs/[jobId].js";
import { onRequestPost as webhook } from "../functions/api/afdian/webhook.js";
import { sha256Hex } from "../functions/lib/api.js";
import { amountFen, CUTOFF, jpegDimensions, paymentConfigured } from "../functions/lib/custom.js";
import { GENERATION_CONFIG } from "../functions/lib/generation-config.js";
import ROLE_FILES from "../functions/lib/role-references.js";
import { composeTransparentLayers, decodePng } from "../functions/lib/transparent-png.js";
import { afdianSignature, moneyFen } from "../functions/lib/payment.js";

const originalFetch = globalThis.fetch;
const emptyConfig = structuredClone(GENERATION_CONFIG);
afterEach(() => { Object.assign(GENERATION_CONFIG, structuredClone(emptyConfig)); globalThis.fetch = originalFetch; });
function makePng(width = 4, height = 4, opaque = false) {
  const image = new PNG({ width, height });
  image.data.fill(0);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 4;
    image.data[offset] = 200;
    image.data[offset + 3] = opaque || (x > 0 && x < width - 1 && y > 0 && y < height - 1) ? 255 : 0;
  }
  return PNG.sync.write(image);
}
const png = makePng();
function layersResponse(overrides = {}) {
  return { data: [
    { z_index: 0, size: "4x4", b64_json: makePng(4, 4, true).toString("base64") },
    { z_index: 1, size: "4x4", bounding_box: { absolute: [0, 0, 4, 4] }, b64_json: png.toString("base64"), ...overrides },
  ] };
}
const jpeg = Uint8Array.from([255, 216, 255, 192, 0, 17, 8, 2, 0, 2, 0, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0, 255, 217]);

test("正式配置使用 Seedream Flash、方形 PNG 和原文提示词，16 个角色共享唯一映射", () => {
  assert.equal(GENERATION_CONFIG.model, "doubao-seedream-5-0-flash-260915");
  assert.equal(GENERATION_CONFIG.size, "2048x2048");
  assert.equal(GENERATION_CONFIG.outputFormat, "png");
  assert.equal(GENERATION_CONFIG.watermark, false);
  assert.equal(GENERATION_CONFIG.prompt, readFileSync(new URL("../../doc/prompts/pet-character.md", import.meta.url), "utf8").trim().replaceAll("\r\n", "\n"));
  assert.equal(Object.keys(ROLE_FILES).length, 16);
  for (const petType of ["cat", "dog"]) {
    const quiz = JSON.parse(readFileSync(new URL(`../public/data/quiz-${petType}.json`, import.meta.url), "utf8"));
    assert.deepEqual(quiz.characters.map((role) => role.id).sort(), Object.keys(ROLE_FILES).sort());
  }
  for (const [roleId, filename] of Object.entries(ROLE_FILES)) {
    assert.equal(GENERATION_CONFIG.roleImageKeys[roleId], `references/${roleId}.png`);
    const original = readFileSync(new URL(`../../free-pic/${filename}`, import.meta.url));
    assert.deepEqual(original, readFileSync(new URL(`../public/role-references/${roleId}.png`, import.meta.url)));
  }
});

test("图层按位置与叠放顺序合成，保持 1:1 透明画布和半透明边缘", () => {
  const red = new PNG({ width: 3, height: 3 }); red.data.fill(0);
  red.data.set([255, 0, 0, 128], 16);
  const blue = new PNG({ width: 3, height: 3 }); blue.data.fill(0);
  blue.data.set([0, 0, 255, 128], 16);
  const payload = { data: [{ z_index: 0, size: "8x8" },
    { z_index: 2, bounding_box: { absolute: [1, 2, 7, 8] }, b64_json: PNG.sync.write(blue).toString("base64") },
    { z_index: 1, bounding_box: { absolute: [1, 2, 7, 8] }, b64_json: PNG.sync.write(red).toString("base64") }] };
  const output = PNG.sync.read(composeTransparentLayers(payload, 8, 8));
  assert.equal(output.width, 8); assert.equal(output.height, 8);
  assert.deepEqual([...output.data.subarray((4 * 8 + 3) * 4, (4 * 8 + 3) * 4 + 4)], [85, 0, 170, 192]);
  assert.equal(output.data[3], 0);
});

test("抠图拒绝不透明层、空白层、损坏 PNG、背景缺失、重复层及越界坐标", () => {
  const blank = new PNG({ width: 4, height: 4 }); blank.data.fill(0);
  const invalid = [
    layersResponse({ b64_json: makePng(4, 4, true).toString("base64") }),
    layersResponse({ b64_json: PNG.sync.write(blank).toString("base64") }),
    layersResponse({ b64_json: png.subarray(0, 40).toString("base64") }),
    layersResponse({ bounding_box: { absolute: [-1, 0, 4, 4] } }),
    layersResponse({ bounding_box: { absolute: [0, 0, 4.5, 4] } }),
    layersResponse({ z_index: 0 }),
    { data: [layersResponse().data[1]] },
    { data: [{ z_index: 0, size: "5x4" }, layersResponse().data[1]] },
  ];
  for (const payload of invalid) assert.throws(() => composeTransparentLayers(payload, 4, 4));
  const huge = Buffer.from(png); huge.writeUInt32BE(100_000, 16);
  assert.throws(() => decodePng(huge.toString("base64")));
  assert.throws(() => decodePng(Buffer.from(jpeg).toString("base64")));
});

async function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../migrations/0001_custom_orders.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0002_order_sku.sql", import.meta.url), "utf8"));
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
    ARK_API_KEY: "test-key", AFDIAN_USER_ID: "creator", AFDIAN_API_TOKEN: "test-token", AFDIAN_PLAN_ID: "2315e4b0d2e911f186f652540025c377", AFDIAN_SKU_ID: "231df344d2e911f1b46452540025c377",
    AFDIAN_PAY_URL: 'https://afdian.com/order/create?product_type=1&plan_id=2315e4b0d2e911f186f652540025c377&sku=%5B%7B%22sku_id%22%3A%22231df344d2e911f1b46452540025c377%22,%22count%22%3A1%7D%5D&viokrz_ex=0',
  };
  const testId = crypto.randomUUID(), token = crypto.randomUUID().replaceAll("-", ""), tokenHash = await sha256Hex(token);
  const result = { testId, petType: "cat", roleId: "mummy", petName: "馒头", tokenHash, status: "completed" };
  kv.set(`session:${testId}`, JSON.stringify({ tokenHash })); kv.set(`result:${testId}`, JSON.stringify(result));
  const photoId = crypto.randomUUID(), expires = Date.now() + 86_400_000;
  db.prepare("INSERT INTO photos VALUES (?, ?, ?, ?, ?)").run(photoId, testId, tokenHash, "photos/pet.jpg", expires);
  await env.PETI_IMAGES.put("photos/pet.jpg", jpeg, { httpMetadata: { contentType: "image/jpeg" } });
  await env.PETI_IMAGES.put("references/style.png", png, { httpMetadata: { contentType: "image/png" } });
  return { db, env, kv, testId, token, photoId, objects };
}
function configured() { GENERATION_CONFIG.size = "4x4"; GENERATION_CONFIG.prompt = "{petType} / {roleId} / {petName}"; GENERATION_CONFIG.roleImageKeys = { mummy: "references/style.png" }; }
function post(handler, fixture, data, params = {}) {
  return handler({ env: fixture.env, params, request: new Request("https://pet.test/api", {
    method: "POST", headers: data instanceof FormData ? { "CF-Connecting-IP": fixture.testId } : { "content-type": "application/json" }, body: data instanceof FormData ? data : JSON.stringify({ token: fixture.token, testId: fixture.testId, photoId: fixture.photoId, ...data }),
  }) });
}
async function newOrder(f) { configured(); return (await post(checkout, f, {})).json(); }
function paidResponse(order, overrides = {}) {
  return Response.json({ ec: 200, data: { list: [{ out_trade_no: "2026102800000001", status: 2, product_type: 1, plan_id: "2315e4b0d2e911f186f652540025c377", sku_detail: [{ sku_id: "231df344d2e911f1b46452540025c377", count: 1 }], total_amount: (order.amountFen / 100).toFixed(2), remark: order.payId, ...overrides }] } });
}

test("价格按北京时间截止点切换，金额解析不使用浮点四舍五入，签名匹配官方示例", () => {
  assert.equal(CUTOFF, Date.parse("2026-10-31T10:00:00Z"));
  assert.equal(amountFen(CUTOFF - 1), 180); assert.equal(amountFen(CUTOFF), 600);
  assert.equal(moneyFen("1.80"), 180); assert.equal(moneyFen("6.00"), 600);
  for (const value of ["2.001", "2", "-2.00", 2, "NaN"]) assert.equal(moneyFen(value), null);
  assert.equal(afdianSignature("123", '{"a":333}', 1624339905, "abc"), "a4acc28b81598b7e5d84ebdc3e91710c");
});
test("空配置、缺参考图、未登记角色、错误照片和伪造凭证均不能创建收费订单", async () => {
  const f = await setup();
  GENERATION_CONFIG.prompt = ""; GENERATION_CONFIG.roleImageKeys = {};
  assert.equal((await post(checkout, f, {})).status, 503);
  configured(); f.objects.delete("references/style.png");
  assert.equal((await post(checkout, f, {})).status, 503);
  await setResultRole(f, "husky");
  assert.equal((await post(checkout, f, {})).status, 503);
  assert.equal((await post(checkout, f, { token: "0".repeat(32) })).status, 401);
  assert.equal((await post(checkout, f, { photoId: "missing" })).status, 400);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM orders").get().n, 0);
});
async function setResultRole(f, roleId) {
  const result = JSON.parse(f.kv.get(`result:${f.testId}`));
  result.roleId = roleId;
  f.kv.set(`result:${f.testId}`, JSON.stringify(result));
}
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
  const url = new URL(a.payUrl);
  assert.equal(url.pathname, "/order/create"); assert.equal(url.searchParams.get("plan_id"), f.env.AFDIAN_PLAN_ID);
  assert.deepEqual(JSON.parse(url.searchParams.get("sku")), [{ sku_id: f.env.AFDIAN_SKU_ID, count: 1 }]);
  assert.equal(url.searchParams.get("remark"), a.payId); assert.equal(url.searchParams.get("viokrz_ex"), "0");
  assert.equal((await post(generate, f, { payId: a.payId })).status, 402);
});
test("选择的角色写入订单并用于生成，已有订单不能改角色", async () => {
  const f = await setup(); configured();
  GENERATION_CONFIG.roleImageKeys.ghost = "references/ghost.png";
  await f.env.PETI_IMAGES.put("references/ghost.png", png, { httpMetadata: { contentType: "image/png" } });
  assert.equal((await post(checkout, f, { roleId: "__proto__" })).status, 400);
  const order = await (await post(checkout, f, { roleId: "ghost" })).json();
  assert.equal(order.roleId, "ghost");
  const saved = JSON.parse(f.db.prepare("SELECT result_json FROM orders").get().result_json);
  assert.equal(saved.testRoleId, "mummy"); assert.equal(saved.roleId, "ghost");
  assert.equal((await post(checkout, f, { roleId: "mummy" })).status, 409);
  f.db.prepare("UPDATE orders SET status = 'unlocked'").run();
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.layer_decomposition) {
      assert.equal(body.image, `data:image/png;base64,${png.toString("base64")}`);
      return Response.json(layersResponse());
    }
    assert.equal(body.prompt, "cat / ghost / 馒头");
    assert.equal(body.image[1], `data:image/png;base64,${Buffer.from(png).toString("base64")}`);
    return Response.json({ data: [{ b64_json: Buffer.from(png).toString("base64") }] });
  };
  assert.equal((await (await post(generate, f, { payId: order.payId })).json()).status, "ready");
});
test("后端查单核验金额、方案、付款状态和留言，不信任客户端已付款字段", async () => {
  const f = await setup(), order = await newOrder(f);
  let response = paidResponse(order, { total_amount: "0.01" });
  globalThis.fetch = async () => response;
  assert.equal((await post(confirm, f, { platformOrderNo: "2026102800000001", paid: true }, { payId: order.payId })).status, 409);
  assert.equal(f.db.prepare("SELECT status FROM orders").get().status, "unpaid");
  for (const overrides of [{ plan_id: "wrong" }, { status: 0 }, { remark: "other-order" }, { product_type: 0 }, { sku_detail: [{ sku_id: "wrong", count: 1 }] }, { sku_detail: [{ sku_id: f.env.AFDIAN_SKU_ID, count: 2 }] }, { sku_detail: null }, {}]) {
    f.db.prepare("UPDATE payment_gate SET next_check_at = 0").run(); response = paidResponse(order, overrides);
    const verified = await post(confirm, f, { platformOrderNo: "2026102800000001" }, { payId: order.payId });
    assert.equal(verified.status, Object.keys(overrides).length ? 409 : 200);
  }
  globalThis.fetch = () => { throw new Error("must not query provider twice"); };
  assert.equal((await post(confirm, f, {}, { payId: order.payId })).status, 200);
  assert.equal(f.db.prepare("SELECT status FROM orders").get().status, "unlocked");
});

test("支付配置只能指向指定型号和单件数量，不接受主页或其他型号", async () => {
  const f = await setup();
  assert.equal(paymentConfigured(f.env), true);
  for (const change of [{ AFDIAN_SKU_ID: "wrong" }, { AFDIAN_PLAN_ID: "wrong" }, { AFDIAN_PAY_URL: "https://afdian.com/a/PETI-Halloween" }]) assert.equal(paymentConfigured({ ...f.env, ...change }), false);
});

test("付款通知不可信，必须二次查单，成功后幂等解锁而不直接生图", async () => {
  const f = await setup(), order = await newOrder(f);
  const data = { data: { type: "order", order: { remark: order.payId, out_trade_no: "2026102800000001" } } };
  let calls = 0;
  globalThis.fetch = async () => { calls++; return paidResponse(order, { total_amount: "0.01" }); };
  assert.equal((await post(webhook, f, data)).status, 409);
  assert.equal(f.db.prepare("SELECT status FROM orders").get().status, "unpaid");
  f.db.prepare("UPDATE payment_gate SET next_check_at = 0").run();
  globalThis.fetch = async () => { calls++; return paidResponse(order); };
  assert.equal((await (await post(webhook, f, data)).json()).ec, 200);
  assert.equal(f.db.prepare("SELECT status FROM orders").get().status, "unlocked");
  assert.equal(f.db.prepare("SELECT attempts FROM orders").get().attempts, 0);
  assert.equal((await (await post(webhook, f, data)).json()).ec, 200);
  assert.equal(calls, 2);
});

test("无 Content-Length 的超大通知也会在解析和查单前被拒绝", async () => {
  const f = await setup();
  globalThis.fetch = () => { throw new Error("must not call provider"); };
  const request = new Request("https://pet.test/api/afdian/webhook", { method: "POST", body: "x".repeat(16_385) });
  assert.equal(request.headers.has("content-length"), false);
  assert.equal((await webhook({ env: f.env, request })).status, 413);
});
test("平台订单号由唯一约束保护，不能被两笔定制认领", async () => {
  const f = await setup(), order = await newOrder(f);
  f.db.prepare("UPDATE orders SET platform_order_no = '2026102800000001', test_id = 'other'").run();
  const second = await (await post(checkout, f, {})).json();
  globalThis.fetch = async () => paidResponse(second);
  assert.equal((await post(confirm, f, { platformOrderNo: "2026102800000001" }, { payId: second.payId })).status, 409);
  assert.equal(f.db.prepare("SELECT status FROM orders WHERE id = ?").get(second.payId).status, "unpaid");
});
test("照片和参考图按顺序打包，并发请求只执行一轮生图和抠图，透明成品需要鉴权", async () => {
  const f = await setup(), order = await newOrder(f);
  f.db.prepare("UPDATE orders SET status = 'unlocked'").run();
  let calls = 0, release;
  const gate = new Promise((resolve) => { release = resolve; });
  globalThis.fetch = async (url, options) => {
    calls++; assert.equal(url, "https://ark.cn-beijing.volces.com/api/v3/images/generations");
    assert.equal(options.headers.authorization, "Bearer test-key");
    const body = JSON.parse(options.body);
    if (body.layer_decomposition) {
      assert.equal(body.image, `data:image/png;base64,${png.toString("base64")}`);
      assert.equal(body.size, "2K");
      assert.equal(body.output_format, "png");
      assert.equal(body.response_format, "b64_json");
      assert.equal(body.watermark, false);
      assert.equal(body.background, undefined);
      return Response.json(layersResponse());
    }
    assert.equal(body.model, GENERATION_CONFIG.model);
    assert.equal(body.prompt, "cat / mummy / 馒头");
    assert.equal(body.response_format, "b64_json");
    assert.equal(body.output_format, "png");
    assert.equal(body.size, "4x4");
    assert.equal(body.watermark, false);
    assert.equal(body.stream, false);
    assert.equal(body.background, undefined);
    assert.equal(body.image.length, 2);
    assert.match(body.image[0], /^data:image\/jpeg;base64,/);
    assert.match(body.image[1], /^data:image\/png;base64,/);
    await gate; return Response.json({ data: [{ b64_json: btoa(String.fromCharCode(...png)) }] });
  };
  const first = post(generate, f, { payId: order.payId });
  while (!calls) await new Promise((resolve) => setTimeout(resolve, 1));
  const second = await post(generate, f, { payId: order.payId });
  assert.equal((await second.json()).status, "generating"); release();
  assert.equal((await (await first).json()).status, "ready");
  assert.equal(calls, 2); assert.equal(f.db.prepare("SELECT attempts FROM orders").get().attempts, 1);
  assert.ok(f.objects.has(`jobs/${order.payId}/source.png`));
  const params = { jobId: order.payId };
  assert.equal((await image({ env: f.env, params, request: new Request("https://pet.test") })).status, 401);
  const downloaded = await image({ env: f.env, params, request: new Request("https://pet.test", { headers: { "X-PT-Token": f.token } }) });
  assert.equal(downloaded.status, 200); assert.match(downloaded.headers.get("cache-control"), /no-store/);
  assert.equal(downloaded.headers.get("content-type"), "image/png");
  const delivered = PNG.sync.read(Buffer.from(await downloaded.arrayBuffer()));
  assert.equal(delivered.width, 4); assert.equal(delivered.height, 4);
  assert.equal(delivered.data[3], 0); assert.equal(delivered.data[(1 * 4 + 1) * 4 + 3], 255);
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

test("真实查单确认后才串联生图和抠图，客户端伪造已付字段无效", async () => {
  const f = await setup(), order = await newOrder(f);
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(url);
    if (url === "https://afdian.com/api/open/query-order") return paidResponse(order);
    const body = JSON.parse(options.body);
    assert.equal(f.db.prepare("SELECT platform_order_no FROM orders").get().platform_order_no, "2026102800000001");
    return Response.json(body.layer_decomposition ? layersResponse() : { data: [{ b64_json: png.toString("base64") }] });
  };
  assert.equal((await post(generate, f, { payId: order.payId, paid: true, status: "unlocked" })).status, 402);
  assert.equal(calls.length, 0);
  assert.equal((await post(confirm, f, { platformOrderNo: "2026102800000001" }, { payId: order.payId })).status, 200);
  assert.equal((await (await post(generate, f, { payId: order.payId })).json()).status, "ready");
  assert.deepEqual(calls, ["https://afdian.com/api/open/query-order", ...Array(2).fill("https://ark.cn-beijing.volces.com/api/v3/images/generations")]);
});

test("抠图失败或返回不透明图片不交付，不再重跑生图，保留原图供核对", async () => {
  for (const mode of ["timeout", "rate-limit", "opaque", "blank", "malformed"]) {
    const f = await setup(), order = await newOrder(f);
    f.db.prepare("UPDATE orders SET status = 'unlocked'").run();
    let calls = 0;
    globalThis.fetch = async (_url, options) => {
      calls++;
      if (!JSON.parse(options.body).layer_decomposition) return Response.json({ data: [{ b64_json: png.toString("base64") }] });
      if (mode === "timeout") throw new Error("timeout");
      if (mode === "rate-limit") return new Response("quota", { status: 429 });
      if (mode === "malformed") return Response.json({ data: [] });
      const blank = new PNG({ width: 4, height: 4 }); blank.data.fill(0);
      return Response.json(layersResponse({ b64_json: (mode === "opaque" ? makePng(4, 4, true) : PNG.sync.write(blank)).toString("base64") }));
    };
    const result = await (await post(generate, f, { payId: order.payId })).json();
    assert.equal(result.status, "uncertain", mode); assert.equal(result.errorCode, "CUTOUT_UNCERTAIN");
    assert.equal(result.retryable, false); assert.equal(result.imageUrl, null);
    await post(generate, f, { payId: order.payId }); assert.equal(calls, 2);
    assert.ok(f.objects.has(`jobs/${order.payId}/source.png`));
    assert.equal(f.objects.has(`jobs/${order.payId}/result.png`), false);
  }
});

test("错误输出格式和损坏生图响应不会调用抠图或交付", async () => {
  for (const output of [{ data: [{ b64_json: Buffer.from(jpeg).toString("base64") }] },
    { data: [{ b64_json: png.subarray(0, 40).toString("base64") }] },
    { data: [{ b64_json: makePng(3, 4).toString("base64") }] },
    { data: [{ error: { code: "invalid" } }] }, { data: [] }]) {
    const f = await setup(), order = await newOrder(f);
    f.db.prepare("UPDATE orders SET status = 'unlocked'").run();
    let calls = 0;
    globalThis.fetch = async () => { calls++; return Response.json(output); };
    assert.equal((await (await post(generate, f, { payId: order.payId })).json()).status, "uncertain");
    assert.equal(calls, 1); assert.equal(f.objects.has(`jobs/${order.payId}/result.png`), false);
  }
});

test("收款前只核验所选角色，缺少该图或密钥时阻止收费", async () => {
  const f = await setup(); configured();
  GENERATION_CONFIG.roleImageKeys.ghost = "references/missing.png";
  assert.equal((await post(checkout, f, { roleId: "ghost" })).status, 503);
  assert.equal((await post(checkout, f, {})).status, 200);
  f.env.ARK_API_KEY = "";
  assert.equal((await post(checkout, f, {})).status, 503);
});

test("原图或透明成品保存失败时停止交付并禁止重复调用", async () => {
  for (const suffix of ["source.png", "result.png"]) {
    const f = await setup(), order = await newOrder(f);
    f.db.prepare("UPDATE orders SET status = 'unlocked'").run();
    const save = f.env.PETI_IMAGES.put;
    f.env.PETI_IMAGES.put = async (key, ...args) => {
      if (key.endsWith(suffix)) throw new Error("storage unavailable");
      await save(key, ...args);
    };
    let calls = 0;
    globalThis.fetch = async (_url, options) => {
      calls++;
      return Response.json(JSON.parse(options.body).layer_decomposition ? layersResponse() : { data: [{ b64_json: png.toString("base64") }] });
    };
    const result = await (await post(generate, f, { payId: order.payId })).json();
    assert.equal(result.status, "uncertain"); assert.equal(result.errorCode, "STORAGE_UNCERTAIN");
    assert.equal(result.imageUrl, null); assert.equal(result.retryable, false);
    await post(generate, f, { payId: order.payId });
    assert.equal(calls, suffix === "source.png" ? 1 : 2);
  }
});
