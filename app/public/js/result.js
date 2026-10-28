import { getState, setState, getResult, saveResult, renameResult, petNameCodePoints } from "./store.js";
import { track } from "./track.js";
import { initCustom } from "./custom.js";

const $ = (id) => document.getElementById(id);
const active = getState();
const requestedId = new URLSearchParams(location.search).get("testId");
let entry = getResult(requestedId || active.testId);
let image;
let cardReady = false;
const ILLUS = {
  nurse: "/assets/illus-nurse.png",
  werewolf: "/assets/illus-werewolf.png",
  zombie: "/assets/illus-zombie.png",
  mummy: "/assets/illus-mummy.png",
};
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
  $("rarity").textContent = `全站仅 ${result.rarityPct}% 的`;
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
  $("saveCardBtn").disabled = true;
  image = new Image();
  image.src = ILLUS[result.roleId] || ILLUS.nurse;
  try {
    await image.decode();
    drawCard();
    cardReady = true;
    $("saveCardBtn").disabled = false;
  } catch {
    $("cardCaption").textContent = "角色图片加载失败，刷新页面重试";
    $("cardCaption").setAttribute("role", "alert");
    drawCard();
  }
  $("resultLoading").classList.add("hidden");
  $("resultMain").classList.remove("hidden");
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

// 同一画布用于预览和下载，姓名修改后两处保持一致。
function drawCard() {
  const canvas = $("cardCanvas");
  const ctx = canvas.getContext("2d");
  const { result, petName } = entry;
  const bg = ctx.createLinearGradient(0, 0, 750, 1000);
  bg.addColorStop(0, "oklch(0.30 0.075 319)");
  bg.addColorStop(1, "oklch(0.17 0.018 15)");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, 750, 1000);
  ctx.strokeStyle = "oklch(0.79 0.16 65 / 0.6)"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(24, 24, 702, 952, 28); ctx.stroke();
  ctx.fillStyle = "oklch(0.79 0.16 65)";
  ctx.font = `24px ${FONT}`; ctx.textAlign = "center";
  ctx.fillText("喵 灵 万 圣 节", 375, 82);
  ctx.fillStyle = "oklch(0.94 0.016 75)";
  ctx.font = `bold 36px ${FONT}`;
  ctx.fillText(result.roleName, 375, 142, 650);
  const glow = ctx.createRadialGradient(375, 470, 40, 375, 470, 330);
  glow.addColorStop(0, "oklch(0.58 0.13 65 / 0.24)");
  glow.addColorStop(1, "oklch(0.30 0.075 319 / 0)");
  ctx.fillStyle = glow; ctx.fillRect(40, 160, 670, 620);
  if (image?.naturalWidth) {
    const scale = Math.min(650 / image.naturalWidth, 600 / image.naturalHeight);
    const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
    ctx.drawImage(image, (750 - w) / 2, 180 + (600 - h) / 2, w, h);
  }
  ctx.fillStyle = "oklch(0.94 0.016 75)";
  ctx.font = `bold 40px ${FONT}`; ctx.fillText(petName, 375, 836, 630);
  ctx.fillStyle = "oklch(0.79 0.16 65)";
  ctx.font = `24px ${FONT}`; ctx.fillText(result.quote, 375, 886, 640);
  ctx.fillStyle = "oklch(0.72 0.022 65)";
  ctx.font = `19px ${FONT}`; ctx.fillText("小红书搜：喵灵万圣节", 375, 934);
  ctx.font = `16px ${FONT}`; ctx.fillText("免费角色卡 · AI 生成角色示意", 375, 961);
  canvas.setAttribute("aria-label", `${petName}的免费角色卡：${result.roleName}。${result.quote}。AI 生成角色示意。`);
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
    drawCard();
    $("resultError").classList.add("hidden");
    closeRename();
    $("nameStatus").textContent = "名字已保存";
  } catch {
    $("resultError").textContent = "名字未能保存，请重试";
    $("resultError").classList.remove("hidden");
  }
});
$("saveCardBtn").addEventListener("click", async () => {
  if (!cardReady) return;
  const btn = $("saveCardBtn");
  btn.disabled = true;
  btn.textContent = "正在保存…";
  try {
    const blob = await new Promise((resolve) => $("cardCanvas").toBlob(resolve, "image/png"));
    if (!blob) throw new Error("empty card");
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = "喵灵万圣节-免费角色卡.png";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    track("export_ready", { type: "free" });
    btn.textContent = "已保存免费卡";
  } catch {
    btn.textContent = "保存失败，点击重试";
  }
  btn.disabled = false;
});
initCustom(() => entry);
$("againBtn").addEventListener("click", () => {
  if (entry) saveResult(entry);
  // 新测在首页点击开始时创建；此处不清除其他宠物未完成的进度。
  location.href = "/index.html";
});
boot();
