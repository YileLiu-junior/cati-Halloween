import { test } from "node:test";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import { fixture } from "./delivery-fixture.mjs";
import { onRequestPost } from "../functions/api/share-images.js";
import { onRequestGet, onRequestHead } from "../functions/api/share-images/[id].js";

const poster = PNG.sync.write(new PNG({ width: 900, height: 1400 }));

function upload(f, body = poster, headers = {}) {
  return onRequestPost({
    env: f.env,
    request: new Request("https://pet.test/api/share-images", {
      method: "POST",
      headers: {
        "content-type": "image/png", "CF-Connecting-IP": f.testId,
        "x-pt-test-id": f.testId, "x-pt-token": f.token, ...headers,
      },
      body,
    }),
  });
}

function get(f, id) {
  return onRequestGet({ env: f.env, params: { id }, request: new Request(`https://pet.test/api/share-images/${id}`) });
}

test("分享图上传后返回带 .png 后缀的公开地址，并带 7 天缓存", async () => {
  const f = await fixture();
  const response = await upload(f);
  assert.equal(response.status, 201);
  const body = await response.json();
  // 微信长按保存按 URL 后缀识别文件类型，无后缀会被存成 .unknown。
  assert.match(body.path, /^\/api\/share-images\/[0-9a-f-]{36}\.png$/);
  assert.equal(body.expiresIn, 604800);
  const id = body.path.split("/").pop();
  const image = await get(f, id);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.equal(image.headers.get("cache-control"), "public, max-age=604800");
  assert.deepEqual(new Uint8Array(await image.arrayBuffer()), new Uint8Array(poster));
});

test("无后缀的旧地址仍可读取，HEAD 探测返回图片而不是回退页面", async () => {
  const f = await fixture();
  const body = await (await upload(f)).json();
  const id = body.path.split("/").pop().replace(/\.png$/, "");
  assert.equal((await get(f, id)).status, 200);
  const head = await onRequestHead({ env: f.env, params: { id: `${id}.png` }, request: new Request(`https://pet.test/api/share-images/${id}.png`, { method: "HEAD" }) });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-type"), "image/png");
  assert.equal(await head.text(), "");
});

test("分享图上传需要有效结果凭证，尺寸不符或非 PNG 会被拒绝", async () => {
  const f = await fixture();
  assert.equal((await upload(f, poster, { "x-pt-token": "0".repeat(32) })).status, 401);
  assert.equal((await upload(f, poster, { "content-type": "text/plain" })).status, 400);
  assert.equal((await upload(f, PNG.sync.write(new PNG({ width: 800, height: 1400 })))).status, 400);
});

test("分享图地址不可枚举，过期或非法 id 返回 404", async () => {
  const f = await fixture();
  assert.equal((await get(f, "not-a-uuid")).status, 404);
  assert.equal((await get(f, crypto.randomUUID())).status, 404);
});
