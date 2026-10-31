import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { main } from "./test-generation.mjs";
import { GENERATION_CONFIG } from "../functions/lib/generation-config.js";

const temporaryRoot = fileURLToPath(new URL("../.wrangler/generation-cli-tests/", import.meta.url));
const originalFetch = globalThis.fetch;
const originalSize = GENERATION_CONFIG.size;
const testKey = "generation-cli-test-key-never-a-real-secret";
let caseDirectory;

// This is a separate test process. Set a fake credential before --live can read .dev.vars.
process.env.ARK_API_KEY = testKey;

beforeEach(async () => {
  await mkdir(temporaryRoot, { recursive: true });
  caseDirectory = await mkdtemp(join(temporaryRoot, "case-"));
  GENERATION_CONFIG.size = "4x4";
  globalThis.fetch = async () => { throw new Error("Unexpected network request in an offline CLI test"); };
});

afterEach(async () => {
  GENERATION_CONFIG.size = originalSize;
  globalThis.fetch = originalFetch;
  const child = relative(temporaryRoot, caseDirectory);
  assert.ok(child && !isAbsolute(child) && !child.startsWith(".."), "Cleanup must stay inside the test directory");
  await rm(caseDirectory, { recursive: true, force: true });
});

function png() {
  const image = new PNG({ width: 4, height: 4 });
  image.data.fill(0);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const offset = (y * 4 + x) * 4;
      image.data[offset] = 180;
      image.data[offset + 1] = 90;
      image.data[offset + 3] = 255;
    }
  }
  return PNG.sync.write(image);
}

async function photoArguments() {
  const path = join(caseDirectory, "pet.jpg");
  // Offline header fixture accepted by the existing dimension guard. It is never sent to a real API.
  await writeFile(path, Uint8Array.from([255, 216, 255, 192, 0, 17, 8, 2, 0, 2, 0, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0, 255, 217]));
  return ["--photo", path, "--role", "ghost", "--pet-type", "cat", "--out", join(caseDirectory, "results")];
}

async function failedReport() {
  const parent = join(caseDirectory, "results");
  const children = (await readdir(parent, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  assert.equal(children.length, 1, "A failed invocation must retain exactly one diagnostic run");
  return JSON.parse(await readFile(join(parent, children[0].name, "report.json"), "utf8"));
}

test("default preflight validates local inputs without making a network request", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("Preflight must not call a provider"); };
  const report = await main(await photoArguments());
  assert.equal(calls, 0);
  assert.equal(report.status, "dry-run-passed");
  assert.equal(report.live, false);
  assert.equal(report.mode, "generation");
  assert.deepEqual(report.requests, []);
  assert.deepEqual((await readdir(report.outputDir)).sort(), ["prompt.txt", "report.json"]);
});

test("live mode sends one generation request and saves the model result plus report", async () => {
  const result = png();
  const requests = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), "https://ark.cn-beijing.volces.com/api/v3/images/generations");
    assert.equal(options.headers.authorization, `Bearer ${testKey}`);
    const body = JSON.parse(options.body);
    requests.push(body);
    assert.equal(requests.length, 1, "No automatic additional provider requests");
    assert.equal(body.layer_decomposition, undefined);
    assert.equal(body.image.length, 2);
    assert.match(body.image[0], /^data:image\/jpeg;base64,/);
    assert.match(body.image[1], /^data:image\/png;base64,/);
    return Response.json({ data: [{ b64_json: result.toString("base64") }] }, { headers: { "x-request-id": "generation-request" } });
  };
  const report = await main([...(await photoArguments()), "--live"]);
  assert.equal(requests.length, 1);
  assert.equal(report.status, "ready");
  assert.deepEqual(report.stages.map((entry) => [entry.stage, entry.status]), [["generation", "ready"]]);
  assert.deepEqual(report.requests.map((entry) => entry.requestId), ["generation-request"]);
  assert.deepEqual(await readFile(join(report.outputDir, "result.png")), result);
  const saved = await readFile(join(report.outputDir, "report.json"), "utf8");
  assert.ok(!saved.includes(testKey));
  assert.ok(!saved.includes("data:image/"));
});

test("provider failure is recorded once, never retried, and redacts credentials and images", async () => {
  const result = png();
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    assert.equal(calls, 1, "A failed generation must not be retried automatically");
    return Response.json({ error: { code: "ProviderFailure", message: `${testKey} data:image/png;base64,${result.toString("base64")}` } }, { status: 500 });
  };
  await assert.rejects(main([...(await photoArguments()), "--live"]), /GENERATION_FAILED/);
  assert.equal(calls, 1);
  const report = await failedReport();
  assert.equal(report.status, "failed");
  await assert.rejects(readFile(join(report.outputDir, "result.png")), { code: "ENOENT" });
  assert.deepEqual(report.stages.map((entry) => [entry.stage, entry.status]), [["generation", "failed"]]);
  assert.equal(report.requests[0].httpStatus, 500);
  assert.equal(report.requests[0].providerError.code, "ProviderFailure");
  assert.equal(report.requests[0].providerError.message, "[redacted] [image]");
  const saved = JSON.stringify(report);
  assert.ok(!saved.includes(testKey));
  assert.ok(!saved.includes(result.toString("base64")));
  assert.ok(!saved.includes("data:image/"));
});
