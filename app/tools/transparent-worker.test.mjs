import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { PNG } from "pngjs";

test("Cloudflare Workers 本地运行环境可解码、合成并导出 2048 方形透明 PNG", async () => {
  const bundled = await build({
    stdin: { resolveDir: fileURLToPath(new URL("../", import.meta.url)), contents: `
      import { composeTransparentLayers, decodePng } from "./functions/lib/transparent-png.js";
      export default { async fetch(request) {
        try {
          const payload = await request.json();
          const { width, height } = decodePng(payload.source);
          return new Response(composeTransparentLayers(payload, width, height));
        }
        catch (error) { return new Response(error.stack, { status: 500 }); }
      }};
    ` },
    platform: "node", format: "esm", bundle: true, write: false,
  });
  const image = new PNG({ width: 3, height: 3 }); image.data.fill(0);
  image.data.set([255, 0, 0, 128], 16);
  const source = new PNG({ width: 2048, height: 2048 }); source.data.fill(255);
  const runtime = new Miniflare({
    modules: true, compatibilityDate: "2025-07-01", compatibilityFlags: ["nodejs_compat"],
    script: bundled.outputFiles[0].text,
  });
  try {
    const response = await runtime.dispatchFetch("http://localhost/", { method: "POST", body: JSON.stringify({ source: PNG.sync.write(source).toString("base64"), data: [
      { z_index: 0, size: "2048x2048" },
      { z_index: 1, bounding_box: { absolute: [424, 424, 1624, 1624] }, b64_json: PNG.sync.write(image).toString("base64") },
    ] }) });
    assert.equal(response.status, 200, response.ok ? "" : await response.text());
    const output = PNG.sync.read(Buffer.from(await response.arrayBuffer()));
    assert.equal(output.width, 2048); assert.equal(output.height, 2048);
    assert.equal(output.data[3], 0);
    assert.deepEqual([...output.data.subarray((1024 * 2048 + 1024) * 4, (1024 * 2048 + 1024) * 4 + 4)], [255, 0, 0, 128]);
  } finally { await runtime.dispose(); }
});
