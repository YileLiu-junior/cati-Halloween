import { roleCardUrl } from "./role-assets.js";
import { getState, setState, getResult, saveResult, renameResult, petNameCodePoints } from "./store.js";
import { track } from "./track.js";
import { initCustom } from "./custom.js";
import { initResultMedia, probabilityText } from "./result-media.js";

const $ = (id) => document.getElementById(id);
const active = getState();
const requestedId = new URLSearchParams(location.search).get("testId");
let entry = getResult(requestedId || active.testId);
let image;
const media = initResultMedia(() => entry);
const ROLES = new Set(["ghost", "zombie", "chainsaw", "mummy", "nurse", "vampire", "franken", "pirate", "clown", "bride", "witch", "werewolf", "bat", "gargoyle", "pharaoh", "pumpkin"]);
const AXES = [["E", "电量"], ["A", "贴贴"], ["B", "胆量"], ["D", "戏精"], ["F", "干饭"], ["C", "好奇"]];
const FONT = '"PingFang SC", "Microsoft YaHei", sans-serif';

async function boot() {
  if (!entry && (!requestedId || requestedId === active.testId) && active.testId && active.token) {
    try {
      const res = await fetch("/api/recover", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: active.token, testId: active.testId }),
      });
      if (res.ok) {
        const result = await res.json();
        if (getState().testId === active.testId) setState({ result });
        else saveResult({ ...active, result });
        entry = getResult(active.testId);
      }
    } catch { /* 无结果时仍提供首页入口。 */ }
  }
  if (!entry) {
    $("resultLoading").classList.add("hidden");
    $("resultEmpty").classList.remove("hidden");
    return;
  }
  saveResult(entry);
  const result = entry.result;
  $("rarity").textContent = probabilityText(entry);
  $("roleName").textContent = result.roleName;
  $("quote").textContent = `「${result.quote}」`;
  $("tagline").textContent = result.tagline || "它的另一面";
  for (const line of result.shortLines) {
    const li = document.createElement("li");
    li.textContent = line;
    $("shortLines").appendChild(li);
  }
  $("petNameText").textContent = entry.petName;
  drawRadar(result.axes);
  // 内容先显示，静态卡片独立加载；不再启动 iframe、WebGL 或感应监听。
  $("resultLoading").classList.add("hidden");
  $("resultMain").classList.remove("hidden");
  $("saveCardBtn").disabled = true;
  image = $("roleCardImage");
  image.alt = `${result.roleName}的静态角色卡`;
  if (ROLES.has(result.roleId)) {
    image.src = roleCardUrl(entry.petType, result.roleId);
    $("viewCardLink").href = image.src;
  }
  try {
    if (!image.src) throw new Error("角色图片未找到");
    await image.decode();
    $("saveCardBtn").disabled = false;
  } catch {
    $("cardCaption").textContent = "角色图片加载失败，刷新页面重试";
    $("cardCaption").setAttribute("role", "alert");
  }
  track("result_view", { roleId: result.roleId });
}

function drawRadar(axes) {
  const canvas = $("radar");
  const ctx = canvas.getContext("2d");
  const cx = 170, cy = 160, radius = 110;
  const point = (i, r) => [cx + r * Math.cos(i * Math.PI / 3 - Math.PI / 2), cy + r * Math.sin(i * Math.PI / 3 - Math.PI / 2)];
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "oklch(0.76 0.07 65 / 0.25)";
  ctx.lineWidth = 1.5;
  for (const ring of [0.25, 0.5, 0.75, 1]) {
    ctx.beginPath();
    for (let i = 0; i <= 6; i++) {
      const [x, y] = point(i % 6, radius * ring);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
  ctx.font = `23px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  AXES.forEach(([key, label], i) => {
    const [x, y] = point(i, radius);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke();
    const [lx, ly] = point(i, radius + 26);
    ctx.fillStyle = "oklch(0.79 0.16 65)";
    ctx.fillText(label, lx, ly);
  });
  ctx.beginPath();
  AXES.forEach(([key], i) => {
    const [x, y] = point(i, radius * Math.max(0, Math.min(10, axes[key] ?? 5)) / 10);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = "oklch(0.49 0.23 316 / 0.45)"; ctx.fill();
  ctx.strokeStyle = "oklch(0.79 0.16 65)"; ctx.lineWidth = 3; ctx.stroke();
  canvas.setAttribute("aria-label", AXES.map(([key, label]) => `${label} ${axes[key] ?? 5}/10`).join("，"));
}

function closeRename() {
  $("renameForm").classList.add("hidden");
  $("petNameDisplay").classList.remove("hidden");
  $("renameBtn").focus({ preventScroll: true });
}
$("renameBtn").addEventListener("click", () => {
  $("nameStatus").textContent = "";
  $("resultError").classList.add("hidden");
  $("petNameDisplay").classList.add("hidden");
  $("renameForm").classList.remove("hidden");
  $("petNameInput").value = entry.petName;
  $("petNameInput").focus({ preventScroll: true });
  $("petNameInput").select();
});
$("cancelNameBtn").addEventListener("click", () => {
  $("resultError").classList.add("hidden");
  closeRename();
});
$("petNameInput").addEventListener("keydown", (event) => {
  if (event.key === "Escape") { event.preventDefault(); $("cancelNameBtn").click(); }
});
$("renameForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const name = $("petNameInput").value.trim();
  if (petNameCodePoints(name) < 1 || petNameCodePoints(name) > 12) {
    $("resultError").textContent = "名字限 1–12 字";
    $("resultError").classList.remove("hidden");
    return;
  }
  try {
    const updated = renameResult(entry.testId, name);
    if (!updated) throw new Error("missing result");
    entry = updated;
    $("petNameText").textContent = name;
    media.invalidate();
    $("resultError").classList.add("hidden");
    closeRename();
    $("nameStatus").textContent = "名字已保存";
  } catch {
    $("resultError").textContent = "名字未能保存，请重试";
    $("resultError").classList.remove("hidden");
  }
});
let rarityPinned = false;
function showRarity(visible) {
  $("rarityHelp").classList.toggle("hidden", !visible);
  $("rarityInfo").setAttribute("aria-expanded", String(visible));
}
$("rarityInfo").addEventListener("click", () => { rarityPinned = !rarityPinned; showRarity(rarityPinned); });
$("rarityInfo").addEventListener("pointerenter", event => { if (event.pointerType === "mouse") showRarity(true); });
$("rarityInfo").addEventListener("pointerleave", () => { if (!rarityPinned) showRarity(false); });
$("rarityInfo").addEventListener("focus", () => showRarity(true));
$("rarityInfo").addEventListener("blur", () => { if (!rarityPinned) showRarity(false); });
document.addEventListener("pointerdown", event => {
  if (!event.target.closest(".rarity-area")) { rarityPinned = false; showRarity(false); }
});
document.addEventListener("keydown", event => { if (event.key === "Escape") { rarityPinned = false; showRarity(false); } });
initCustom(() => entry);
$("againBtn").addEventListener("click", () => {
  if (entry) saveResult(entry);
  // 新测在首页点击开始时创建；此处不清除其他宠物未完成的进度。
  location.href = "/";
});
boot();
