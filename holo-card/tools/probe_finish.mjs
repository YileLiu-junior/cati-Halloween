/**
 * finish 决定性实验：设置 uFinish 后在页面内同步 renderer.render()，再经 CDP clip 截图。
 * 排除软件渲染循环慢导致的"抓到旧帧"时序假象。
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
  const profile = mkdtempSync(path.join(tmpdir(), "fin-"));
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

  const clipRaw = await ev(`(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`);
  const clip = { ...clipRaw, scale: 1 };
  const shot = async (tag) => {
    const { data } = await send("Page.captureScreenshot", { format: "png", clip });
    const buf = Buffer.from(data, "base64");
    writeFileSync(`tools/probe-out/finish-${tag}.png`, buf);
    return createHash("sha256").update(buf).digest("hex").slice(0, 12);
  };
  // setFinish 走 UI 状态 + 同步渲染一帧，杜绝旧帧
  const setU = (v) => ev(`(()=>{const H=window.__holo;H.uniforms.uFinish.value=${v};H.uniforms.uFoil.value=0.3;H.renderer.render(H.root.parent,H.camera);return H.uniforms.uFinish.value})()`);
  await ev(`window.__holo.reset()`); await sleep(800);
  const P = await shot("pearl-0");   // 先抓当前循环帧
  void await setU(0);
  const P2 = await shot("pearl-sync");
  void await setU(1);
  const S = await shot("silver-sync");
  void await setU(3);
  const G = await shot("gold-sync");
  void await setU(2);
  const O = await shot("original-sync");
  void await setU(0);
  console.log("pearl(loop) :", P);
  console.log("pearl(sync) :", P2, P === P2 ? "  == loop frame" : "  != loop frame");
  console.log("silver(sync):", S, P2 === S ? "  == pearl" : "  != pearl");
  console.log("gold(sync)  :", G, P2 === G ? "  == pearl" : "  != pearl");
  console.log("original(sy):", O, P2 === O ? "  == pearl" : "  != pearl");
  child.kill("SIGKILL"); try { rmSync(profile, { recursive: true, force: true }); } catch {}
  process.exit(0);
})().catch(e => { console.error("ERR", e.message); process.exit(2); });
