import { track } from "./track.js";

const $ = (id) => document.getElementById(id);
const FONT = '"PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
const INK = "oklch(0.94 0.016 75)", MUTED = "oklch(0.72 0.022 65)", GOLD = "oklch(0.79 0.16 65)";
const QR_SRC = "/assets/peti-official-qr.png";
const QR_PANEL = 404, QR_IMAGE = 324, QR_PAD = (QR_PANEL - QR_IMAGE) / 2;
const QR_TOP_GAP = 40, QR_CAPTION_GAP = 22, QR_BOTTOM_PAD = 56;
let qrRequest;

function loadQr() {
  // 二维码只是分享图的附加信息，加载失败时仍然输出完整结果图。
  qrRequest ||= new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = QR_SRC;
  });
  return qrRequest;
}

export const probabilityText = (entry) => `抽中该万圣节${entry.petType === "dog" ? "汪汪" : "喵喵"}卡的概率为 ${entry.result.rarityPct}%`;

function lines(ctx, text, width, font) {
  ctx.font = `${font} ${FONT}`;
  const characters = globalThis.Intl?.Segmenter
    ? Array.from(new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(text), part => part.segment)
    : Array.from(text);
  const result = []; let line = "";
  for (const character of characters) {
    if (line && ctx.measureText(line + character).width > width) { result.push(line); line = ""; }
    line += character;
  }
  if (line) result.push(line);
  return result;
}

// 直接复用结果数据、高清卡片和已绘制的六轴图，不额外下载截图依赖。
function drawPoster(entry, image, qr) {
  const canvas = $("cardCanvas"), ctx = canvas.getContext("2d");
  const { petName, result } = entry;
  const lead = lines(ctx, `${petName}万圣节会扮演的角色是…`, 756, "32px");
  const title = lines(ctx, result.roleName, 756, "750 48px");
  const quote = lines(ctx, `「${result.quote}」`, 744, "36px");
  const tagline = lines(ctx, result.tagline || "它的另一面", 376, "650 34px");
  const descriptions = result.shortLines.map(text => lines(ctx, text, 376, "28px"));
  const cardY = 64 + lead.length * 46 + 18 + title.length * 64 + 28;
  const cardWidth = 540, cardHeight = cardWidth * image.naturalHeight / image.naturalWidth;
  const quoteY = cardY + cardHeight + 38;
  const rarityY = quoteY + quote.length * 54 + 14;
  const traitsY = rarityY + 100;
  const copyHeight = tagline.length * 48 + 24 + descriptions.reduce((height, text) => height + text.length * 44 + 18, 0);
  const traitsHeight = Math.max(365, copyHeight);
  const baseHeight = Math.ceil(traitsY + traitsHeight + 128);
  const qrBlock = qr ? QR_TOP_GAP + QR_PANEL + QR_CAPTION_GAP + 32 + QR_BOTTOM_PAD : 0;
  canvas.width = 900;
  canvas.height = baseHeight + qrBlock;
  ctx.fillStyle = "oklch(0.18 0.018 319)"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textBaseline = "top"; ctx.textAlign = "center";
  const text = (rows, x, y, font, height, color) => {
    ctx.font = `${font} ${FONT}`; ctx.fillStyle = color;
    rows.forEach((row, i) => ctx.fillText(row, x, y + i * height));
  };
  text(lead, 450, 64, "32px", 46, MUTED);
  text(title, 450, 64 + lead.length * 46 + 18, "750 48px", 64, INK);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 180, cardY, cardWidth, cardHeight);
  text(quote, 450, quoteY, "36px", 54, GOLD);
  text([probabilityText(entry)], 450, rarityY, "25px", 36, MUTED);
  ctx.strokeStyle = "oklch(0.76 0.07 65 / 0.22)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(64, traitsY - 28); ctx.lineTo(836, traitsY - 28); ctx.stroke();
  ctx.drawImage($("radar"), 24, traitsY + (traitsHeight - 365) / 2, 400, 365);
  ctx.textAlign = "left";
  text(tagline, 452, traitsY, "650 34px", 48, INK);
  let y = traitsY + tagline.length * 48 + 24;
  for (const description of descriptions) {
    text(description, 452, y, "28px", 44, MUTED);
    y += description.length * 44 + 18;
  }
  ctx.textAlign = "center";
  text(["喵灵万圣节 · 每只毛孩子都有另一面"], 450, baseHeight - 82, "24px", 32, GOLD);
  text(["AI 生成角色示意"], 450, baseHeight - 44, "19px", 24, MUTED);
  if (qr) {
    // 分享图末尾附活动二维码：白底面板顺带补齐静区，缩到手机宽度也还能扫。
    const qrTop = baseHeight + QR_TOP_GAP, qrLeft = (900 - QR_PANEL) / 2;
    ctx.fillStyle = "oklch(0.985 0.004 85)";
    ctx.fillRect(qrLeft, qrTop, QR_PANEL, QR_PANEL);
    ctx.drawImage(qr, qrLeft + QR_PAD, qrTop + QR_PAD, QR_IMAGE, QR_IMAGE);
    text(["扫码或长按识别 · 给毛孩子做一张万圣节头像"], 450, qrTop + QR_PANEL + QR_CAPTION_GAP, "23px", 32, MUTED);
  }
  canvas.setAttribute("aria-label", `${petName}的测评结果。${result.roleName}。${result.quote}。${$("radar").getAttribute("aria-label")}。${result.tagline}。${result.shortLines.join("。")}。${qr ? "文末附活动二维码。" : ""}`);
  return canvas;
}

export function initResultMedia(getEntry) {
  const share = $("shareDialog"), viewer = $("imageViewer"), viewport = $("imageViewport");
  let posterPromise, posterUrl, posterLocalUrl, zoom = 1, fitWidth = 0, viewerTrigger;
  const lockPage = () => document.documentElement.classList.toggle("media-open", share.open || viewer.open);
  const isWeChat = /MicroMessenger/i.test(navigator.userAgent);
  // 微信 WebView 的原生保存不认 blob: 图片；上传到短期托管换取 https 地址。
  async function hostPoster(blob) {
    const entry = getEntry();
    if (!entry?.testId || !entry?.token) return null;
    try {
      const response = await fetch("/api/share-images", {
        method: "POST",
        headers: { "content-type": "image/png", "X-PT-Test-Id": entry.testId, "X-PT-Token": entry.token },
        body: blob,
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) return null;
      const data = await response.json().catch(() => null);
      return typeof data?.path === "string" && /^\/api\/share-images\/[0-9a-f-]{36}$/i.test(data.path)
        ? new URL(data.path, location.origin).href
        : null;
    } catch {
      return null;
    }
  }
  function setZoom(value) {
    const previousWidth = fitWidth * zoom;
    const x = (viewport.scrollLeft + viewport.clientWidth / 2) / (previousWidth + 32 || 1);
    const y = (viewport.scrollTop + viewport.clientHeight / 2) / (viewport.scrollHeight || 1);
    zoom = Math.max(1, Math.min(3, value));
    $("viewerImage").style.width = `${fitWidth * zoom}px`;
    $("resetImageZoom").textContent = `${Number(zoom.toFixed(1))}×`;
    $("zoomOutImage").disabled = zoom === 1;
    $("zoomInImage").disabled = zoom === 3;
    viewport.scrollLeft = x * (fitWidth * zoom + 32) - viewport.clientWidth / 2;
    viewport.scrollTop = y * viewport.scrollHeight - viewport.clientHeight / 2;
  }
  function fitImage() {
    const image = $("viewerImage");
    if (!image.naturalWidth) return;
    fitWidth = Math.min(image.naturalWidth, Math.max(1, viewport.clientWidth - 32), Math.max(1, viewport.clientHeight - 32) * image.naturalWidth / image.naturalHeight);
    setZoom(1); viewport.scrollTop = viewport.scrollLeft = 0;
  }
  function viewImage(source, title, alt, trigger) {
    viewerTrigger = trigger;
    $("imageViewerTitle").textContent = title;
    $("viewerImage").alt = alt;
    $("viewerImage").src = source;
    $("openOriginalImage").href = source;
    if (!viewer.open) viewer.showModal();
    lockPage(); fitImage();
  }
  $("viewerImage").addEventListener("load", fitImage);
  $("viewCardLink").addEventListener("click", event => {
    const image = $("roleCardImage");
    if (!image.complete || !image.naturalWidth) return;
    event.preventDefault(); viewImage(image.dataset.viewSrc || image.currentSrc, "角色卡大图", image.alt, $("viewCardLink"));
  });
  $("closeImageViewer").addEventListener("click", () => viewer.close());
  viewer.addEventListener("close", () => { lockPage(); viewerTrigger?.focus({ preventScroll: true }); });
  $("zoomInImage").addEventListener("click", () => setZoom(zoom + 0.5));
  $("zoomOutImage").addEventListener("click", () => setZoom(zoom - 0.5));
  $("resetImageZoom").addEventListener("click", fitImage);
  $("viewerImage").addEventListener("dblclick", () => setZoom(zoom === 1 ? 2 : 1));
  window.addEventListener("resize", () => { if (viewer.open) fitImage(); });

  function posterDataUrl() {
    const url = $("cardCanvas").toDataURL("image/png");
    return url.length > 2_000_000 ? $("cardCanvas").toDataURL("image/jpeg", 0.92) : url;
  }
  function usePosterFallback() {
    posterUrl = posterDataUrl();
    $("sharePreviewImage").src = posterUrl;
    $("saveShareImage").href = posterUrl;
    return posterUrl;
  }
  // 托管地址偶发不可达时，退回到微信也能长按保存的 data URL。
  $("sharePreviewImage").addEventListener("error", () => {
    if (isWeChat && !String($("sharePreviewImage").src).startsWith("data:")) usePosterFallback();
  });
  $("viewerImage").addEventListener("error", () => {
    if (isWeChat && !String($("viewerImage").src).startsWith("data:")) $("viewerImage").src = usePosterFallback();
  });
  async function makePoster() {
    const [qr] = await Promise.all([loadQr(), document.fonts.ready]);
    const canvas = drawPoster(getEntry(), $("roleCardImage"), qr);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("生成分享图片失败，请关闭后重试");
    posterLocalUrl = URL.createObjectURL(blob);
    posterUrl = posterLocalUrl;
    if (isWeChat) {
      const hosted = await hostPoster(blob);
      // 托管失败时退回 data URL；它同样能被微信长按保存，过大再降为 JPEG。
      posterUrl = hosted || posterDataUrl();
      if (hosted) { URL.revokeObjectURL(posterLocalUrl); posterLocalUrl = ""; }
    }
    track("export_ready", { type: "result" });
    return posterUrl;
  }
  $("saveCardBtn").addEventListener("click", async () => {
    if ($("saveCardBtn").disabled) return;
    track("share_click", { test_id: getEntry()?.testId });
    if (!share.open) share.showModal();
    lockPage();
    $("shareStatus").textContent = posterUrl ? "" : "正在整理分享图片…";
    try {
      posterPromise ||= makePoster().catch(error => { posterPromise = null; throw error; });
      const url = await posterPromise;
      const entry = getEntry();
      $("sharePreviewImage").src = url;
      $("sharePreviewImage").alt = $("cardCanvas").getAttribute("aria-label");
      $("sharePreview").classList.remove("hidden");
      track("share_preview_view", { test_id: entry.testId });
      $("previewShareLarge").classList.remove("hidden");
      $("saveShareImage").href = url;
      $("saveShareImage").download = `喵灵万圣节-${entry.petName.replace(/[<>:"/\\|?*\x00-\x1f]/g, "")}-测评结果.png`;
      $("saveShareImage").classList.remove("hidden");
      $("shareStatus").textContent = "";
    } catch (error) { $("shareStatus").textContent = error.message; }
  });
  $("closeShareBtn").addEventListener("click", () => share.close());
  share.addEventListener("close", () => { lockPage(); $("saveCardBtn").focus({ preventScroll: true }); });
  $("previewShareLarge").addEventListener("click", () => viewImage(posterUrl, "分享图片大图", $("sharePreviewImage").alt, $("previewShareLarge")));
  $("saveShareImage").addEventListener("click", event => {
    track("share_save_click", { test_id: getEntry()?.testId, save_method: isWeChat ? "long_press_instruction" : "download" });
    if (isWeChat) { event.preventDefault(); $("shareStatus").textContent = "请长按上方图片，选择保存到手机。"; }
    else $("shareStatus").textContent = "已发起保存；也可以长按预览图片保存。";
  });
  function invalidate() {
    if (posterLocalUrl) URL.revokeObjectURL(posterLocalUrl);
    posterPromise = posterUrl = posterLocalUrl = undefined;
    $("sharePreview").classList.add("hidden");
    $("previewShareLarge").classList.add("hidden");
    $("saveShareImage").classList.add("hidden");
  }
  window.addEventListener("pagehide", event => { if (!event.persisted) invalidate(); });
  // 定制头像复用同一套大图查看器，保留双指缩放、长按保存和“打开原图”。
  return { invalidate, viewImage };
}
