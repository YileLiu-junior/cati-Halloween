import { Buffer } from "node:buffer";
// 浏览器构建不依赖 Node Stream/zlib 私有实现，可在 Cloudflare Workers 中解码。
import pngjs from "pngjs/browser.js";

const { PNG } = pngjs;

export function decodePng(encoded) {
  if (typeof encoded !== "string" || !encoded.length || encoded.length > 45_000_000) throw new Error("invalid image data");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    || bytes.toString("ascii", 12, 16) !== "IHDR") throw new Error("invalid PNG");
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  // 解码前限制像素量，避免异常尺寸耗尽 Worker 内存。
  if (!width || !height || width > 8192 || height > 8192 || width * height > 4_624_220) throw new Error("invalid dimensions");
  return { ...PNG.sync.read(bytes), bytes };
}

function hasSubjectAndTransparency(data) {
  let transparent = false, subject = false;
  for (let i = 3; i < data.length; i += 4) {
    transparent ||= data[i] === 0;
    subject ||= data[i] > 0;
    if (transparent && subject) return true;
  }
  return false;
}

// 图层是裁切图，依据 absolute 边界放回原始方形画布；不把 z_index=0 的背景合成进去。
export function composeTransparentLayers(payload, width, height) {
  if (!Number.isInteger(width) || width !== height || width < 1 || width * height > 4_624_220) throw new Error("invalid canvas size");
  if (payload?.error || !Array.isArray(payload?.data) || payload.data.length < 2 || payload.data.length > 17
    || payload.data.some((layer) => layer.error || !Number.isInteger(layer.z_index) || layer.z_index < 0)
    || new Set(payload.data.map((layer) => layer.z_index)).size !== payload.data.length) throw new Error("invalid layers");
  const base = payload.data.find((layer) => layer.z_index === 0);
  if (!base || base.size !== `${width}x${height}`) throw new Error("invalid base size");
  const canvas = new PNG({ width, height });
  canvas.data.fill(0);
  const layers = payload.data.filter((layer) => layer.z_index > 0).sort((a, b) => a.z_index - b.z_index);
  for (const layer of layers) {
    const box = layer.bounding_box?.absolute;
    if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isInteger)) throw new Error("missing layer bounds");
    const [left, top, right, bottom] = box;
    if (left < 0 || top < 0 || right > width || bottom > height || left >= right || top >= bottom) throw new Error("invalid layer bounds");
    const image = decodePng(layer.b64_json);
    if (!hasSubjectAndTransparency(image.data)) throw new Error("layer has no cutout");
    for (let y = top; y < bottom; y++) {
      for (let x = left; x < right; x++) {
        const src = (Math.floor((y - top) * image.height / (bottom - top)) * image.width
          + Math.floor((x - left) * image.width / (right - left))) * 4;
        const dst = (y * width + x) * 4;
        const alpha = image.data[src + 3] / 255;
        if (!alpha) continue;
        const behind = canvas.data[dst + 3] / 255 * (1 - alpha);
        const combined = alpha + behind;
        for (let channel = 0; channel < 3; channel++) canvas.data[dst + channel] = Math.round((image.data[src + channel] * alpha + canvas.data[dst + channel] * behind) / combined);
        canvas.data[dst + 3] = Math.round(combined * 255);
      }
    }
  }
  if (!hasSubjectAndTransparency(canvas.data)) throw new Error("output has no cutout");
  return PNG.sync.write(canvas, { colorType: 6, deflateLevel: 3, filterType: 0 });
}
