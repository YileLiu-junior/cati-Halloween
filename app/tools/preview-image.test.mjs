import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import jpeg from "jpeg-js";
import { configured, fixture, newOrder, paid, png, storedOrder } from "./delivery-fixture.mjs";
import { bindVerifiedPayment } from "../functions/lib/payment.js";
import { processGeneration } from "../functions/lib/generation-jobs.js";
import { onRequestGet as image } from "../functions/api/jobs/[jobId]/image.js";
import { previewJpeg } from "../functions/lib/preview-image.js";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("展示缩略图把 2048px 原图压成 1024px 以内的 JPEG", () => {
  const source = PNG.sync.write(new PNG({ width: 2048, height: 2048 }));
  const preview = previewJpeg(source);
  assert.equal(preview[0], 0xff);
  assert.equal(preview[1], 0xd8);
  const decoded = jpeg.decode(preview);
  assert.equal(decoded.width, 1024);
  assert.equal(decoded.height, 1024);
  assert.ok(preview.length < 300_000);
});

test("?preview=1 返回并缓存 JPEG，保存用的原图仍是 PNG", async () => {
  const f = await fixture();
  configured();
  const o = await newOrder(f);
  await bindVerifiedPayment(f.env, storedOrder(f, o.payId), paid(o));
  globalThis.fetch = async () => Response.json({ data: [{ b64_json: png.toString("base64") }] });
  await processGeneration(f.env, o.payId);
  const request = (query = "") => new Request(`https://pet.test/api/jobs/${o.payId}/image${query}`, { headers: { "X-PT-Token": f.token } });

  const original = await image({ env: f.env, params: { jobId: o.payId }, request: request() });
  assert.equal(original.status, 200);
  assert.equal(original.headers.get("content-type"), "image/png");

  const preview = await image({ env: f.env, params: { jobId: o.payId }, request: request("?preview=1") });
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get("content-type"), "image/jpeg");
  const bytes = new Uint8Array(await preview.arrayBuffer());
  assert.equal(bytes[0], 0xff);
  assert.equal(bytes[1], 0xd8);

  const order = storedOrder(f, o.payId);
  assert.ok(await f.env.PETI_IMAGES.head(`${order.image_key}.preview.jpg`));
  const cached = await image({ env: f.env, params: { jobId: o.payId }, request: request("?preview=1") });
  assert.deepEqual(new Uint8Array(await cached.arrayBuffer()), bytes);
});
