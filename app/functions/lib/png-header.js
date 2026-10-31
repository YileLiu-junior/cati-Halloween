import { Buffer } from "node:buffer";
export function inspectPng(encoded) {
  if (typeof encoded !== "string" || !encoded.length || encoded.length > 45_000_000) throw new Error("invalid image data");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    || bytes.toString("ascii", 12, 16) !== "IHDR") throw new Error("invalid PNG");
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  // 解码前限制像素量，避免异常尺寸耗尽 Worker 内存。
  if (!width || !height || width > 8192 || height > 8192 || width * height > 4_624_220) throw new Error("invalid dimensions");
  if (bytes.toString("ascii", bytes.length - 8, bytes.length - 4) !== "IEND") throw new Error("incomplete PNG");
  return { bytes, width, height };
}

