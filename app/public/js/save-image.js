// 头像保存：本地合成暖白底 JPG；手机优先打开系统面板存入相册，全程不离开页面。

const WARM_WHITE = "#fdfaf3";

export const isWeChat = () => /MicroMessenger/i.test(navigator.userAgent);

// 成品是透明 PNG；JPG 不支持透明，用暖白底补齐，避免相册里出现黑底。
// maxEdge 为 0 时保持原图尺寸，移动端编码失败时再降级到 1600px 重试。
function jpegCanvas(image, maxEdge) {
  const scale = maxEdge ? Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight)) : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器无法保存图片");
  context.fillStyle = WARM_WHITE;
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (scale < 1) { context.imageSmoothingEnabled = true; context.imageSmoothingQuality = "high"; }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// 部分手机 WebView 的 toBlob 不回调或返回 null；加超时并保留可降级的失败原因。
function blobFromCanvas(canvas, quality, timeout = 8_000) {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== "function") { reject(new Error("当前浏览器不支持保存图片")); return; }
    let settled = false;
    const timer = setTimeout(() => { settled = true; reject(new Error("图片编码超时")); }, timeout);
    const finish = (blob) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      blob ? resolve(blob) : reject(new Error("图片编码失败"));
    };
    try { canvas.toBlob(finish, "image/jpeg", quality); }
    catch (error) { settled = true; clearTimeout(timer); reject(error); }
  });
}

// toBlob 失败时用同步的 toDataURL 兜底，兼容部分微信/安卓 WebView。
function blobFromDataUrl(canvas, quality) {
  const match = /^data:([^;,]+)?;base64,(.*)$/.exec(canvas.toDataURL("image/jpeg", quality));
  if (!match) throw new Error("图片编码失败");
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: "image/jpeg" });
}

export async function jpegBlobFromImage(image, quality = 0.92) {
  if (!image?.naturalWidth) {
    // 图片元素可能刚拿到 blob URL；给解码一点时间再判断。
    await Promise.race([image?.decode?.().catch(() => {}), new Promise(resolve => setTimeout(resolve, 3_000))]);
  }
  if (!image?.naturalWidth) throw new Error("图片还没加载完，请稍后再试");
  const attempts = [
    () => blobFromCanvas(jpegCanvas(image, 0), quality),
    () => blobFromDataUrl(jpegCanvas(image, 0), quality),
    () => blobFromCanvas(jpegCanvas(image, 1_600), quality),
    () => blobFromDataUrl(jpegCanvas(image, 1_600), quality),
  ];
  let lastError;
  for (const attempt of attempts) {
    try { return await attempt(); }
    catch (error) { lastError = error; }
  }
  throw lastError || new Error("保存图片失败，请稍后重试");
}

// 页面展示用缩略图地址；点击保存时再请求不带参数的高清原图。
export const previewUrl = (url) => `${url}${url.includes("?") ? "&" : "?"}preview=1`;

// 保存时按需读取高清原图（页面上的图可能只是缩略图），再转成 JPG。
export async function jpegFromUrl(url, token) {
  const response = await fetch(url, {
    headers: token ? { "X-PT-Token": token } : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.message || "高清原图读取失败，请稍后重试");
  }
  const objectUrl = URL.createObjectURL(await response.blob());
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode().catch(() => {});
    return await jpegBlobFromImage(image);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

// 微信不能长按保存 blob: 图片；保存前上传成带 .jpg/.png 后缀的短期直链再显示。
export function imageHost({ testId, token, orderId, orderToken } = {}) {
  return async (blob) => {
    const headers = { "content-type": blob.type || "image/jpeg" };
    if (testId && token) { headers["X-PT-Test-Id"] = testId; headers["X-PT-Token"] = token; }
    else if (orderId && orderToken) { headers["X-PT-Order-Id"] = orderId; headers["X-PT-Order-Token"] = orderToken; }
    else return null;
    try {
      const response = await fetch("/api/save-images", {
        method: "POST", headers, body: blob, signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) return null;
      const data = await response.json().catch(() => null);
      return typeof data?.path === "string" && /^\/api\/save-images\/[0-9a-f-]{36}\.(?:png|jpg)$/i.test(data.path)
        ? new URL(data.path, location.origin).href
        : null;
    } catch {
      return null;
    }
  };
}

// 换成可长按保存的 https 地址；加载失败时还原，避免页面上的图变成裂图。
function swapImageSource(image, url) {
  if (!image) return Promise.resolve(false);
  const previous = image.src;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      image.removeEventListener("load", onload); image.removeEventListener("error", onerror);
      if (!ok && previous) image.src = previous;
      resolve(ok);
    };
    const onload = () => finish(true);
    const onerror = () => finish(false);
    const timer = setTimeout(() => finish(false), 10_000);
    image.addEventListener("load", onload);
    image.addEventListener("error", onerror);
    image.src = url;
  });
}

export function canShareFile(file) {
  try {
    return typeof navigator.share === "function" && typeof navigator.canShare === "function"
      && matchMedia("(pointer: coarse)").matches && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

const blobUrls = new WeakMap();
const liveUrls = [];
function blobUrl(blob) {
  let url = blobUrls.get(blob);
  if (!url) { url = URL.createObjectURL(blob); blobUrls.set(blob, url); liveUrls.push(url); }
  return url;
}
// 不在下载后立即回收：部分浏览器会在 blob URL 回收时取消尚未写完的下载。
// 同一张图重复保存复用同一个 URL，页面离开时统一释放。
window.addEventListener("pagehide", () => {
  for (const url of liveUrls) URL.revokeObjectURL(url);
  liveUrls.length = 0;
});

export function downloadBlob(blob, filename) {
  const link = document.createElement("a");
  link.href = blobUrl(blob); link.download = filename; link.rel = "noopener";
  link.click();
}

// 返回 shared / downloaded / wechat / cancelled，调用方据此给状态文案。
// options.host + options.target：微信里先托管图片并把页面上的图换成 https 地址，
// 这样用户长按保存时微信能正常写入相册（blob: 图片会提示保存失败）。
export async function shareOrDownload(blob, filename, title, options = {}) {
  const file = new File([blob], filename, { type: blob.type || "image/jpeg" });
  if (canShareFile(file)) {
    try {
      await navigator.share({ files: [file], title });
      return "shared";
    } catch (error) {
      if (error.name === "AbortError") return "cancelled";
    }
  }
  // 手机微信不支持文件下载，也不该把用户带去新页面；桌面微信仍可下载。
  if (isWeChat() && matchMedia("(pointer: coarse)").matches) {
    const { host, target, onHosted } = options;
    if (host && target) {
      const url = await host(blob);
      if (url && await swapImageSource(target, url)) { onHosted?.(url); }
    }
    return "wechat";
  }
  downloadBlob(blob, filename);
  return "downloaded";
}

export const jpegName = (name) => `${name}.jpg`;
