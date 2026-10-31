import UPNG from "upng-js";
import jpeg from "jpeg-js";

// 展示用缩略图：把 2048×2048、约 5MB 的成品压成 1024px JPEG（约 100KB），
// 手机端打开得快；点保存时再读取原图。透明区域按白底合成，和产品图一致。
const MAX_EDGE = 1024;
const QUALITY = 82;

function boxAverage(source, sourceWidth, sourceHeight, width, height) {
  const ratioX = sourceWidth / width, ratioY = sourceHeight / height;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * ratioY);
    const y1 = Math.min(sourceHeight, Math.max(y0 + 1, Math.ceil((y + 1) * ratioY)));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * ratioX);
      const x1 = Math.min(sourceWidth, Math.max(x0 + 1, Math.ceil((x + 1) * ratioX)));
      let r = 0, g = 0, b = 0, covered = 0, count = 0;
      for (let sy = y0; sy < y1; sy++) {
        const row = sy * sourceWidth;
        for (let sx = x0; sx < x1; sx++) {
          const index = (row + sx) * 4;
          const alpha = source[index + 3] / 255;
          r += source[index] * alpha;
          g += source[index + 1] * alpha;
          b += source[index + 2] * alpha;
          covered += alpha;
          count += 1;
        }
      }
      const offset = (y * width + x) * 4;
      const white = 255 * (1 - covered / count);
      data[offset] = Math.round(r / count + white);
      data[offset + 1] = Math.round(g / count + white);
      data[offset + 2] = Math.round(b / count + white);
      data[offset + 3] = 255;
    }
  }
  return data;
}

export function previewJpeg(bytes) {
  const buffer = bytes instanceof ArrayBuffer
    ? bytes
    : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const decoded = UPNG.decode(buffer);
  const source = new Uint8Array(UPNG.toRGBA8(decoded)[0]);
  const scale = Math.min(1, MAX_EDGE / Math.max(decoded.width, decoded.height));
  const width = Math.max(1, Math.round(decoded.width * scale));
  const height = Math.max(1, Math.round(decoded.height * scale));
  const data = boxAverage(source, decoded.width, decoded.height, width, height);
  return new Uint8Array(jpeg.encode({ data, width, height }, QUALITY).data);
}
