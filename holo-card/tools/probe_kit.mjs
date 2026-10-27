/**
 * kit 定向验收：对给定 URL 检查 ready、卡名、uniform 与锁定值一致、翻面可用，并截正面图。
 * 用法：node tools/probe_kit.mjs <url> <expected_title> <out_png>
 * 期望锁定值：scale .95 / depth .19 / fx .72 / bg .26 / foil 1.0 / finish silver(1)
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

const [BASE, TITLE, OUTPNG] = process.argv.slice(2);
const EXPECT = { uScale: 0.95, uDepth: 0.19, uFxDepth: 0.72, uBgDepth: 0.26, uFoil: 1, uFinish: 1 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe"].find(existsSync);
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });

(async () => {
  const port = await freePort();
  const profile = mkdtempSync(path.join(tmpdir(), "kit-"));
  const child = spawn(browser, ["--headless=new", "--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--disable-gpu", "--hide-scrollbars", "--no-first-run", `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, "--window-size=1024,700", "about:blank"], { stdio: "ignore" });
  let target = null;
  for (let i = 0; i < 40; i++) { await sleep(500); try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); target = l.find((t) => t.type === "page"); if (target) break; } catch {} }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener("open", r, { once: true }); ws.addEventListener("error", j, { once: true }); });
  let seq = 0;
  const send = (m, pr = {}, tmo = 30000) => new Promise((res, rej) => { const id = ++seq; ws.send(JSON.stringify({ id, method: m, params: pr })); const h = (ev) => { const d = JSON.parse(ev.data); if (d.id === id) { ws.removeEventListener("message", h); d.error ? rej(new Error(JSON.stringify(d.error))) : res(d.result); } }; ws.addEventListener("message", h); setTimeout(() => { ws.removeEventListener("message", h); rej(new Error("timeout " + m)); }, tmo); });
  const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result.value; };

  await send("Page.enable"); await send("Runtime.enable");
  await send("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 60; i++) { await sleep(500); try { if (await ev(`!!(window.__holo&&window.__holo.ready)`)) { ready = true; break; } } catch {} }
  if (!ready) throw new Error("viewer never became ready");

  const got = await ev(`(()=>{const u=window.__holo.uniforms;return {
    title: window.__holo.config.title,
    finishName: document.getElementById('finish-name').textContent.trim(),
    u:{uScale:u.uScale.value,uDepth:u.uDepth.value,uFxDepth:u.uFxDepth.value,uBgDepth:u.uBgDepth.value,uFoil:u.uFoil.value,uFinish:u.uFinish.value},
    layers:['tSubject','tBackground','tLine','tText'].map(k=>window.__holo.uniforms[k].value.image.width)
  }})()`);
  let ok = got.title === TITLE;
  const diffs = [];
  for (const [k, v] of Object.entries(EXPECT)) {
    if (Math.abs(got.u[k] - v) > 1e-6) { ok = false; diffs.push(`${k}=${got.u[k]}(期望${v})`); }
  }
  const oneCanvas = new Set(got.layers).size === 1;
  console.log(`title: ${got.title} (${ok ? "匹配" : "不匹配"})  质面: ${got.finishName}`);
  console.log(`uniforms: ${JSON.stringify(got.u)}  ${diffs.length ? "MISMATCH: " + diffs.join(", ") : "与锁定值一致"}`);
  console.log(`四层同画布: ${oneCanvas ? "是" : "否 " + got.layers}`);

  await ev(`window.__holo.reset()`); await sleep(3500);
  const clip = await ev(`(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()`);
  const { data } = await send("Page.captureScreenshot", { format: "png", clip });
  writeFileSync(OUTPNG, Buffer.from(data, "base64"));
  console.log("正面截图 ->", OUTPNG);
  child.kill("SIGKILL"); try { rmSync(profile, { recursive: true, force: true }); } catch {}
  process.exit(ok && oneCanvas && !diffs.length ? 0 : 1);
})().catch(e => { console.error("ERR", e.message); process.exit(2); });
