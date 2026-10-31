import { test } from "node:test";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import { configured, fixture, jpeg, newOrder, storedOrder } from "./delivery-fixture.mjs";
import { orderAccessToken } from "../functions/lib/order-access.js";
import { onRequestPost } from "../functions/api/save-images.js";
import { onRequestGet, onRequestHead } from "../functions/api/save-images/[id].js";

const avatar = PNG.sync.write(new PNG({ width: 1200, height: 1200 }));

function upload(f, body, headers = {}) {
  return onRequestPost({
    env: f.env,
    request: new Request("https://pet.test/api/save-images", {
      method: "POST",
      headers: { "content-type": "image/png", "CF-Connecting-IP": f.testId, "X-PT-Test-Id": f.testId, "X-PT-Token": f.token, ...headers },
      body,
    }),
  });
}

function get(f, id) {
  return onRequestGet({ env: f.env, params: { id }, request: new Request(`https://pet.test/api/save-images/${id}`) });
}

test("结果凭证可托管头像，地址带图片后缀并原样读回", async () => {
  const f = await fixture();
  const response = await upload(f, avatar);
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.match(body.path, /^\/api\/save-images\/[0-9a-f-]{36}\.png$/);
  assert.equal(body.expiresIn, 86400);
  const id = body.path.split("/").pop();
  const image = await get(f, id);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.equal(image.headers.get("cache-control"), "public, max-age=86400");
  assert.deepEqual(new Uint8Array(await image.arrayBuffer()), new Uint8Array(avatar));
  // 旧的无后缀地址仍然可读。
  assert.equal((await get(f, id.replace(/\.png$/, ""))).status, 200);
});

test("订单凭证可托管 JPG 头像，HEAD 探测返回图片", async () => {
  const f = await fixture();
  configured();
  const order = await newOrder(f);
  const token = await orderAccessToken(f.env, storedOrder(f, order.payId));
  const response = await upload(f, jpeg, {
    "content-type": "image/jpeg", "X-PT-Test-Id": "", "X-PT-Token": "",
    "X-PT-Order-Id": order.payId, "X-PT-Order-Token": token,
  });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.match(body.path, /^\/api\/save-images\/[0-9a-f-]{36}\.jpg$/);
  const id = body.path.split("/").pop();
  const image = await get(f, id);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/jpeg");
  const head = await onRequestHead({ env: f.env, params: { id }, request: new Request(`https://pet.test/api/save-images/${id}`, { method: "HEAD" }) });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-type"), "image/jpeg");
  assert.equal(await head.text(), "");
});

test("缺少或错误凭证、格式不符的图片会被拒绝", async () => {
  const f = await fixture();
  assert.equal((await upload(f, avatar, { "X-PT-Token": "0".repeat(32) })).status, 401);
  assert.equal((await upload(f, avatar, { "X-PT-Test-Id": "", "X-PT-Token": "" })).status, 401);
  assert.equal((await upload(f, avatar, { "content-type": "text/plain" })).status, 400);
  assert.equal((await upload(f, new Uint8Array([1, 2, 3, 4]))).status, 400);
});

test("头像地址不可枚举，非法 id 返回 404", async () => {
  const f = await fixture();
  assert.equal((await get(f, "not-a-uuid")).status, 404);
  assert.equal((await get(f, crypto.randomUUID())).status, 404);
});
