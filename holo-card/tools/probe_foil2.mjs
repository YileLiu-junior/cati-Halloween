/**
 * foil 画布响应测量（CDP clip 只截 canvas 区域）：
 *   A foil=0.3（默认）  B foil=1.0  C foil=0.0  对照组 D uScale+0.05
 * 若 B/C 与 A 哈希相同而 D 不同 -> 画布确实不响应 uFoil（查看器/材质问题）。
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

const BASE = process.argv[2] || "http://127.0.0.1:4173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe"].find(existsSync);
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });

(async () => {
  const port = await freePort();
  const profile = mkdtempSync(path.join(tmpdir(), "foil2-"));
  const child = spawn(browser, ["--headless=new", "--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--disable-gpu", "--hide-scrollbars", "--no-first-run", `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, "--window-size=1024,700", "about:blank"], { stdio: "ignore" });
  let target = null;
  for (let i = 0; i < 40; i++) { await sleep(500); try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); target = l.find((t) => t.type === "page"); if (target) break; } catch {} }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener("open", r, { once: true }); ws.addEventListener("error", j, { once: true }); });
  let seq = 0;
  const send = (m, pr = {}, tmo = 30000) => new Promise((res, rej) => { const id = ++seq; ws.send(JSON.stringify({ id, method: m, params: pr })); const h = (ev) => { const d = JSON.parse(ev.data); if (d.id === id) { ws.removeEventListener("message", h); d.error ? rej(new Error(JSON.stringify(d.error))) : res(d.result); } }; ws.addEventListener("message", h); setTimeout(() => { ws.removeEventListener("message", h); rej(new Error("timeout " + m)); }, tmo); });
  const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400)); return r.result.value; };

  await send("Page.enable"); await send("Runtime.enable");
  await send("Page.navigate", { url: BASE });
  for (let i = 0; i < 60; i++) { await sleep(500); if (await ev(`!!(window.__holo&&window.__holo.ready)`)) break; }

  const clipRaw = await ev(`(()=>{const r=document.querySelector('canvas').getBoundingClientRect();
    return {x:r.x,y:r.y,width:r.width,height:r.height}})()`);
  const clip = { ...clipRaw, scale: 1 };
  console.log("canvas rect =", JSON.stringify(clipRaw), " hidden =", await ev("document.hidden"));
  const shot = async (tag) => {
    const { data } = await send("Page.captureScreenshot", { format: "png", clip });
    const buf = Buffer.from(data, "base64");
    writeFileSync(`tools/probe-out/foil-${tag}.png`, buf);
    return createHash("sha256").update(buf).digest("hex").slice(0, 12);
  };
  await ev(`window.__holo.reset()`); await sleep(1200);
  const A = await shot("A-default0.3");
  await ev(`window.__holo.uniforms.uFoil.value = 1.0`); await sleep(900);
  const B = await shot("B-foil1.0");
  await ev(`window.__holo.uniforms.uFoil.value = 0.0`); await sleep(900);
  const C = await shot("C-foil0.0");
  await ev(`window.__holo.uniforms.uFoil.value = 0.3`);
  await ev(`window.__holo.uniforms.uScale.value = 1.3`); await sleep(900);
  const D = await shot("D-scale1.3");
  console.log("A foil0.3 :", A);
  console.log("B foil1.0 :", B, A === B ? "  == A" : "  != A");
  console.log("C foil0.0 :", C, A === C ? "  == A" : "  != A");
  console.log("D scale1.3:", D, A === D ? "  == A (control failed!)" : "  != A (control ok)");
  child.kill("SIGKILL"); rmSync(profile, { recursive: true, force: true });
  process.exit(0);
})().catch(e => { console.error("ERR", e.message); process.exit(2); });
