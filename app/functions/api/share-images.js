import { clientIp, json, rateLimit } from "../lib/api.js";
import { authorize, fail, guarded } from "../lib/custom.js";

const MAX_BYTES = 4 * 1024 * 1024;
const TTL = 7 * 24 * 60 * 60;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

// 分享图由客户端 canvas 生成，固定 900px 宽、高度随内容变化。
// 只接受符合这一形状的 PNG，避免被当成任意文件存储。
function inspectPoster(bytes) {
  if (bytes.length < 33 || bytes.length > MAX_BYTES) return null;
  if (!PNG_SIGNATURE.every((value, index) => bytes[index] === value)) return null;
  if (String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width !== 900 || height < 1200 || height > 6000) return null;
  return { width, height };
}

export const onRequestPost = ({ request, env }) => guarded(async () => {
  if (!env.PETI_KV) fail("SERVICE_NOT_CONFIGURED", "分享图片服务尚未开放，请稍后再试", 503);
  if (Number(request.headers.get("content-length")) > MAX_BYTES + 4096) {
    fail("IMAGE_TOO_LARGE", "分享图片过大，请稍后重试", 413);
  }
  if (!rateLimit(`share-image-ip:${clientIp(request)}`, 10)) {
    fail("RATE_LIMITED", "生成太频繁，请稍后再试", 429, true);
  }
  const { tokenHash } = await authorize(env, request.headers.get("x-pt-test-id"), request.headers.get("x-pt-token"));
  if (!rateLimit(`share-image-token:${tokenHash}`, 10)) {
    fail("RATE_LIMITED", "生成太频繁，请稍后再试", 429, true);
  }
  if (!String(request.headers.get("content-type") || "").startsWith("image/png")) {
    fail("IMAGE_INVALID", "分享图片格式无效");
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  const image = inspectPoster(bytes);
  if (!image) fail("IMAGE_INVALID", "分享图片格式无效");
  const id = crypto.randomUUID();
  // KV 自带 7 天过期；地址为不可枚举 UUID，图片只含用户主动分享的结果内容。
  await env.PETI_KV.put(`share-image:${id}`, bytes, {
    expirationTtl: TTL,
    metadata: { contentType: "image/png", width: image.width, height: image.height },
  });
  // URL 必须带图片后缀：微信长按保存会按后缀决定文件类型，没有后缀会存成 .unknown。
  return json({ path: `/api/share-images/${id}.png`, expiresIn: TTL }, 201);
});
