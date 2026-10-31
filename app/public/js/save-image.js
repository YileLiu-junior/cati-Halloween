// 头像保存：本地合成暖白底 JPG；手机优先打开系统面板存入相册，全程不离开页面。

const WARM_WHITE = "#fdfaf3";

export const isWeChat = () => /MicroMessenger/i.test(navigator.userAgent);

export function jpegBlobFromImage(image, quality = 0.92) {
  return new Promise((resolve, reject) => {
    if (!image?.naturalWidth) { reject(new Error("图片还没加载完，请稍后再试")); return; }
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    // 成品是透明 PNG；JPG 不支持透明，用暖白底补齐，避免相册里出现黑底。
    context.fillStyle = WARM_WHITE;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("保存图片失败，请稍后重试")), "image/jpeg", quality);
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
export async function shareOrDownload(blob, filename, title) {
  const file = new File([blob], filename, { type: "image/jpeg" });
  if (canShareFile(file)) {
    try {
      await navigator.share({ files: [file], title });
      return "shared";
    } catch (error) {
      if (error.name === "AbortError") return "cancelled";
    }
  }
  // 手机微信不支持文件下载，也不该把用户带去新页面；桌面微信仍可下载。
  if (isWeChat() && matchMedia("(pointer: coarse)").matches) return "wechat";
  downloadBlob(blob, filename);
  return "downloaded";
}

export const jpegName = (name) => `${name}.jpg`;
