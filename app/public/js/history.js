// 历史档案：首页和结果页共用的全屏抽屉，列出过往测评和已生成的头像。
// 照片与头像只从云端按需读取（保留 7 天），不在本机缓存图片。
import { getHistory, saveGeneration } from "./store.js";
import { roleThumbUrl } from "./role-assets.js";
import { jpegBlobFromImage, shareOrDownload } from "./save-image.js";

const ROLE_ID = /^[a-z]{2,16}$/;
const MAX_PROBES = 8;
const imageUrls = new Map();

let sheet, resultsList, avatarsList, avatarsEmpty;
let lastFocus = null;

const dayLabel = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : `${date.getMonth() + 1}月${date.getDate()}日`;
};

function createSheet() {
  if (sheet) return sheet;
  sheet = document.createElement("dialog");
  sheet.className = "history-sheet";
  sheet.setAttribute("aria-labelledby", "historyTitle");
  sheet.innerHTML = `
    <header class="history-head">
      <div>
        <p class="history-kicker">本浏览器</p>
        <h2 id="historyTitle">毛孩子的万圣节档案</h2>
      </div>
      <button class="icon-button" type="button" data-history-close aria-label="关闭历史记录">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
      </button>
    </header>
    <div class="history-body">
      <p class="history-note">只在这台设备上可见；清除网站数据或更换浏览器后，记录会消失。</p>
      <section class="history-group" aria-labelledby="historyResultsTitle">
        <h3 id="historyResultsTitle">测评记录</h3>
        <ul class="history-results" id="historyResults"></ul>
      </section>
      <section class="history-group" aria-labelledby="historyAvatarsTitle">
        <h3 id="historyAvatarsTitle">生成的头像</h3>
        <ul class="history-avatars" id="historyAvatars"></ul>
        <p class="history-empty" id="historyAvatarsEmpty" hidden></p>
      </section>
    </div>`;
  document.body.appendChild(sheet);
  resultsList = sheet.querySelector("#historyResults");
  avatarsList = sheet.querySelector("#historyAvatars");
  avatarsEmpty = sheet.querySelector("#historyAvatarsEmpty");
  sheet.querySelector("[data-history-close]").addEventListener("click", () => sheet.close());
  sheet.addEventListener("click", (event) => { if (event.target === sheet) sheet.close(); });
  sheet.addEventListener("close", () => {
    document.documentElement.classList.remove("history-open");
    lastFocus?.focus({ preventScroll: true });
  });
  return sheet;
}

function roleImage(entry, roleId) {
  if (!["cat", "dog"].includes(entry.petType) || !ROLE_ID.test(roleId || "")) return null;
  const image = document.createElement("img");
  image.className = "history-thumb";
  image.loading = "lazy";
  image.decoding = "async";
  image.alt = "";
  image.src = roleThumbUrl(entry.petType, roleId);
  return image;
}

function renderResults(entries) {
  resultsList.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement("li");
    empty.className = "history-empty";
    empty.textContent = "还没有测评记录，先去做一次吧。";
    resultsList.appendChild(empty);
    return;
  }
  for (const entry of entries) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.className = "history-result";
    link.href = `/result?testId=${encodeURIComponent(entry.testId)}`;
    const thumb = roleImage(entry, entry.result?.roleId);
    if (thumb) link.appendChild(thumb);
    const text = document.createElement("span");
    text.className = "history-result-text";
    const name = document.createElement("strong");
    name.textContent = entry.petName || "未命名";
    const role = document.createElement("span");
    role.textContent = entry.result?.roleName || "";
    text.append(name, role);
    const tail = document.createElement("span");
    tail.className = "history-result-tail";
    if (entry.generation?.status === "ready") {
      const badge = document.createElement("span");
      badge.className = "history-badge";
      badge.textContent = "已生成";
      tail.appendChild(badge);
    }
    const date = document.createElement("span");
    date.className = "history-date";
    date.textContent = dayLabel(entry.completedAt);
    tail.append(date);
    link.append(text, tail);
    link.insertAdjacentHTML("beforeend", '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>');
    item.appendChild(link);
    resultsList.appendChild(item);
  }
}

// 先向下单接口确认这一份测评有没有订单；离线时回退到本地记下的订单引用。
// 每次打开抽屉都重新确认，用户重新生成后能拿到新的角色和交付时间。
async function resolveGeneration(entry) {
  let generation = null;
  if (entry.token) {
    try {
      const response = await fetch(`/api/free-orders?testId=${encodeURIComponent(entry.testId)}`, {
        headers: { "X-PT-Token": entry.token }, cache: "no-store", signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) {
        const order = (await response.json())?.order;
        if (order?.status === "ready" && order.imageUrl) {
          generation = {
            orderId: order.orderId, photoId: order.photoId, roleId: order.roleId, roleName: order.roleName,
            petType: order.petType, status: "ready", imageUrl: order.imageUrl,
            expiresAt: order.expiresAt, deliveredAt: order.deliveredAt,
          };
        }
      }
    } catch { /* 网络失败时继续用本地记录。 */ }
  }
  if (!generation && entry.generation?.status === "ready" && entry.generation.orderId) {
    generation = { ...entry.generation, imageUrl: entry.generation.imageUrl || `/api/jobs/${entry.generation.orderId}/image` };
  }
  if (generation) {
    const previous = entry.generation;
    if (!previous || previous.orderId !== generation.orderId || previous.roleId !== generation.roleId
      || previous.status !== generation.status || previous.deliveredAt !== generation.deliveredAt) {
      saveGeneration(entry.testId, generation);
    }
  }
  return generation;
}

async function fetchImage(url, token, key) {
  if (imageUrls.has(key)) return { url: imageUrls.get(key) };
  try {
    const response = await fetch(url, { headers: { "X-PT-Token": token }, cache: "no-store", signal: AbortSignal.timeout(60_000) });
    if (response.status === 410) return { expired: true };
    if (!response.ok) return { error: true };
    const url_ = URL.createObjectURL(await response.blob());
    imageUrls.set(key, url_);
    return { url: url_ };
  } catch {
    return { error: true };
  }
}

function statusNode(text) {
  const span = document.createElement("span");
  span.className = "history-shot-status";
  span.textContent = text;
  return span;
}

function setShot(card, kind, result, alt) {
  const slot = card.querySelector(`[data-shot="${kind}"]`);
  if (result.url) {
    const image = new Image();
    image.src = result.url;
    image.alt = alt;
    image.decoding = "async";
    slot.replaceChildren(image);
    slot.dataset.state = "ready";
    return result.url;
  }
  slot.dataset.state = result.expired ? "expired" : "error";
  slot.replaceChildren(statusNode(result.expired ? "已过保留期" : "暂时不可用"));
  return null;
}

function makeCard(entry, generation) {
  const item = document.createElement("li");
  item.className = "history-avatar";
  const detailId = `history-detail-${generation.orderId}`;
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "history-avatar-toggle";
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", detailId);
  toggle.innerHTML = `
    <span class="history-pair">
      <span class="history-shot" data-shot="photo"><span class="history-shot-status">加载中</span></span>
      <span class="history-arrow" aria-hidden="true">→</span>
      <span class="history-shot" data-shot="avatar"><span class="history-shot-status">加载中</span></span>
    </span>
    <span class="history-avatar-meta"><strong></strong><small></small></span>`;
  toggle.querySelector("strong").textContent = generation.roleName || entry.result?.roleName || "万圣节头像";
  toggle.querySelector("small").textContent = [entry.petName, dayLabel(entry.completedAt)].filter(Boolean).join(" · ");
  toggle.addEventListener("click", () => {
    const open = item.dataset.open !== "true";
    item.dataset.open = String(open);
    toggle.setAttribute("aria-expanded", String(open));
    // 展开后再预编码 JPG，点击保存时能直接打开系统面板。
    if (open) warmAvatarJpeg(item);
  });
  const detail = document.createElement("div");
  detail.className = "history-detail";
  detail.id = detailId;
  detail.innerHTML = `
    <p class="history-detail-note">左边是你上传的照片，右边是生成的头像。云端只保留 7 天。</p>
    <div class="history-detail-actions">
      <a class="secondary history-save hidden">保存头像</a>
      <a class="text-button" href="/result?testId=${encodeURIComponent(entry.testId)}">查看这份测评</a>
    </div>
    <p class="history-save-status" role="status" aria-live="polite"></p>`;
  item.append(toggle, detail);
  return item;
}

function warmAvatarJpeg(card) {
  if (card._avatarJpeg || card._avatarJpegRequest) return;
  const image = card.querySelector('[data-shot="avatar"] img');
  if (!image) return;
  card._avatarJpegRequest = (image.complete ? Promise.resolve() : image.decode().catch(() => {}))
    .then(() => jpegBlobFromImage(image))
    .then((blob) => { card._avatarJpeg = blob; })
    .catch(() => {})
    .finally(() => { card._avatarJpegRequest = null; });
}

function enableSave(card, url, name) {
  const save = card.querySelector(".history-save");
  save.href = url;
  save.download = name;
  save.classList.remove("hidden");
  // 和结果页一致：保存得到 JPG，手机走系统面板存入相册，不打开新页面。
  save.addEventListener("click", async (event) => {
    event.preventDefault();
    if (save.dataset.busy === "true") return;
    save.dataset.busy = "true";
    const status = card.querySelector(".history-save-status");
    const image = card.querySelector('[data-shot="avatar"] img');
    try {
      const blob = card._avatarJpeg || await jpegBlobFromImage(image);
      card._avatarJpeg = blob;
      const outcome = await shareOrDownload(blob, name, "毛孩子的万圣节头像");
      status.textContent = {
        shared: "已打开保存面板，选择“存储图像”即可存入相册。",
        downloaded: "已保存 JPG，可在相册或下载中查看。",
        wechat: "微信里请长按右侧头像保存到手机。",
        cancelled: "",
      }[outcome];
    } catch {
      status.textContent = "保存失败，请长按右侧头像保存。";
    } finally {
      delete save.dataset.busy;
    }
  });
}

async function loadImages(entry, generation, card) {
  const expires = Date.parse(generation.expiresAt || "");
  if (Number.isFinite(expires) && expires <= Date.now()) {
    for (const kind of ["photo", "avatar"]) {
      const slot = card.querySelector(`[data-shot="${kind}"]`);
      slot.dataset.state = "expired";
      slot.replaceChildren(statusNode("已过保留期"));
    }
    card.querySelector(".history-detail-note").textContent = "这份头像已超过 7 天云端保留期，照片和头像都不再提供查看。";
    return;
  }
  const token = entry.token;
  const photo = fetchImage(`/api/photos/${encodeURIComponent(generation.photoId)}`, token, `photo:${generation.photoId}`);
  // 同一订单重新生成时交付时间会变，用它做缓存键，避免继续显示旧头像。
  const avatar = fetchImage(generation.imageUrl || `/api/jobs/${generation.orderId}/image`, token, `avatar:${generation.orderId}:${generation.deliveredAt || ""}`);
  const [photoResult, avatarResult] = await Promise.all([photo, avatar]);
  setShot(card, "photo", photoResult, "上传的宠物照片");
  const avatarUrl = setShot(card, "avatar", avatarResult, "生成的万圣节头像");
  if (avatarUrl) {
    const safeName = String(entry.petName || "毛孩子").replace(/[<>:"/\\|?*\x00-\x1f]/g, "");
    enableSave(card, avatarUrl, `PETI-${safeName}-万圣节头像.jpg`);
  }
  if (photoResult.expired || photoResult.error || avatarResult.expired || avatarResult.error) {
    card.querySelector(".history-detail-note").textContent = photoResult.expired || avatarResult.expired
      ? "云端只保留 7 天，其中一张原图已过保留期。"
      : "有一张图暂时读取失败，可以关闭后重试。";
  }
}

async function loadGenerations(entries) {
  avatarsList.replaceChildren();
  avatarsEmpty.hidden = true;
  if (!entries.length) {
    avatarsEmpty.textContent = "还没有生成过头像。在结果页上传一张照片，就能给它换上万圣节造型。";
    avatarsEmpty.hidden = false;
    return;
  }
  // 已知生成记录优先探测，剩下的按新旧补到上限；渲染时仍按测评时间排序。
  const indexed = entries.map((entry, index) => ({ entry, index }));
  const known = indexed.filter(({ entry }) => entry.generation?.status === "ready");
  const unknown = indexed.filter(({ entry }) => entry.generation?.status !== "ready").slice(0, Math.max(0, MAX_PROBES - known.length));
  const targets = [...known, ...unknown].sort((a, b) => a.index - b.index);
  const resolved = [];
  const pending = [...targets];
  const worker = async () => {
    while (pending.length) {
      const { entry, index } = pending.shift();
      const generation = await resolveGeneration(entry);
      if (generation) resolved.push({ entry, generation, index });
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  if (!resolved.length) {
    avatarsEmpty.textContent = "还没有生成过头像。在结果页上传一张照片，就能给它换上万圣节造型。";
    avatarsEmpty.hidden = false;
    return;
  }
  resolved.sort((a, b) => a.index - b.index);
  for (const { entry, generation } of resolved) {
    const card = makeCard(entry, generation);
    avatarsList.appendChild(card);
    void loadImages(entry, generation, card);
  }
}

async function open(trigger) {
  lastFocus = trigger;
  createSheet();
  if (!sheet.open) sheet.showModal();
  document.documentElement.classList.add("history-open");
  const entries = getHistory();
  renderResults(entries);
  await loadGenerations(entries);
  // 生成卡片可能刚从服务端补回订单，重画一次让「已生成」角标同步。
  renderResults(getHistory());
}

export function initHistory() {
  for (const button of document.querySelectorAll("[data-history-open]")) {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      void open(button);
    });
  }
  window.addEventListener("pagehide", (event) => {
    if (event.persisted) return;
    for (const url of imageUrls.values()) URL.revokeObjectURL(url);
    imageUrls.clear();
  });
}
