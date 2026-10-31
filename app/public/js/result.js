import { roleCardUrl, roleAtlasUrl } from "./role-assets.js";
import { getState, setState, getResult, saveResult, renameResult, petNameCodePoints, fetchQuiz } from "./store.js";
import { initTrack, track, observeView } from "./track.js";
initTrack();
import { initCustom } from "./custom.js";
import { initHistory } from "./history.js";
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
  track("result_view", { test_id: entry.testId, pet_type: entry.petType, role_id: result.roleId });
  observeView($("saveCardBtn"), "share_entry_view", () => ({ test_id: entry.testId }));
  observeView($("customBtn"), "generation_entry_view", () => ({ test_id: entry.testId }));
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
// 角色集合复用选角图集：先看 16 格，点单个角色进入单角色查看。
let collectionReady = false;
let collectionAtlas = "";
let activeCollectionCard = null;

function showCollectionDetail(role, index, card) {
  activeCollectionCard = card;
  $("collectionGrid").classList.add("hidden");
  $("collectionIntro").classList.add("hidden");
  $("collectionDetail").classList.remove("hidden");
  $("collectionTitle").textContent = role.name;
  const image = $("collectionDetailImage");
  image.src = collectionAtlas;
  image.alt = role.name;
  image.style.transform = `translate(${-25 * (index % 4)}%, ${-25 * Math.floor(index / 4)}%)`;
  $("collectionDetailName").textContent = role.name;
  $("collectionDetailMeta").textContent = `模拟占比 ${role.rarityPct}%`;
  $("collectionDetailQuote").textContent = `「${role.quote}」`;
  $("collectionDetailName").focus({ preventScroll: true });
}

function showCollectionGrid({ focus = true } = {}) {
  $("collectionDetail").classList.add("hidden");
  $("collectionGrid").classList.remove("hidden");
  $("collectionIntro").classList.remove("hidden");
  $("collectionTitle").textContent = "16 个角色";
  if (focus) activeCollectionCard?.focus({ preventScroll: true });
  activeCollectionCard = null;
}

async function openRoleCollection() {
  const dialog = $("roleCollectionDialog");
  if (!dialog.open) dialog.showModal();
  if (collectionReady) return;
  try {
    const quiz = await fetchQuiz(entry.petType);
    collectionAtlas = roleAtlasUrl(entry.petType);
    const fragment = document.createDocumentFragment();
    quiz.characters.forEach((role, index) => {
      const item = document.createElement("li");
      item.className = "collection-item";
      const card = document.createElement("button");
      card.type = "button";
      card.className = "collection-card";
      card.setAttribute("aria-label", `查看${role.name}`);
      const portrait = document.createElement("span");
      portrait.className = "collection-portrait";
      portrait.setAttribute("aria-hidden", "true");
      const image = document.createElement("img");
      image.src = collectionAtlas;
      image.alt = "";
      image.decoding = "async";
      image.style.transform = `translate(${-25 * (index % 4)}%, ${-25 * Math.floor(index / 4)}%)`;
      portrait.appendChild(image);
      const name = document.createElement("span");
      name.className = "collection-name";
      name.textContent = role.name;
      card.append(portrait, name);
      card.addEventListener("click", () => showCollectionDetail(role, index, card));
      item.appendChild(card);
      fragment.appendChild(item);
    });
    $("collectionGrid").replaceChildren(fragment);
    $("collectionIntro").textContent = "定制头像时可以任选一个。";
    collectionReady = true;
  } catch {
    $("collectionIntro").textContent = "角色暂时加载失败，关闭后重试。";
  }
}
$("roleCollectionBtn").addEventListener("click", () => { void openRoleCollection(); });
$("closeCollectionBtn").addEventListener("click", () => $("roleCollectionDialog").close());
$("collectionBack").addEventListener("click", () => showCollectionGrid());
$("roleCollectionDialog").addEventListener("close", () => {
  showCollectionGrid({ focus: false });
  $("roleCollectionBtn").focus({ preventScroll: true });
});
initCustom(() => entry, media.viewImage);
initHistory();
$("againBtn").addEventListener("click", () => {
  if (entry) saveResult(entry);
  // 新测在首页点击开始时创建；此处不清除其他宠物未完成的进度。
  location.href = "/";
});
boot();
