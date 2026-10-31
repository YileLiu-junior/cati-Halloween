import { test } from "node:test";
import assert from "node:assert/strict";

const storage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};
test("analytics buffers before SDK load and sends only selected context", async () => {
  globalThis.localStorage = storage();
  globalThis.sessionStorage = storage();
  let script;
  globalThis.document = { createElement: () => ({}), head: { appendChild: value => { script = value; } } };
  Object.defineProperty(globalThis, "navigator", { value: { userAgent: "test" }, configurable: true });
  const captured = [];
  globalThis.window = { PETI_CONFIG: { posthogToken: "test" }, posthog: {
    init: () => {}, capture: (name, props) => captured.push({ name, props }),
  } };
  const { initTrack, track } = await import("../public/js/track.js");
  initTrack();
  localStorage.setItem("peti:v1", JSON.stringify({ anonId: "anonymous", testId: "test-1", token: "secret", petName: "private" }));
  track("quiz_start");
  assert.equal(captured.length, 0);
  script.onload();
  assert.equal(captured.length, 1);
  assert.equal(captured[0].props.test_id, "test-1");
  assert.equal(captured[0].props.anon_id, "anonymous");
  assert.ok(captured[0].props.visit_id);
  assert.ok(!JSON.stringify(captured).includes("secret"));
  assert.ok(!JSON.stringify(captured).includes("private"));
  assert.deepEqual(JSON.parse(sessionStorage.getItem("peti:analytics:pending")), []);
});
