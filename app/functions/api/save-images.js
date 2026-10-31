import { clientIp, json, rateLimit } from "../lib/api.js";
import { authorize, fail, guarded, loadOrder } from "../lib/custom.js";

// 微信内置浏览器无法长按保存 blob: 图片，需要换成带图片后缀的 https 直链。
// 头像只在保存时临时托管，24 小时过期，地址为不可枚举的 UUID。
const MAX_BYTES = 8 * 1024 * 1024;
const TTL = 24 * 60 * 60;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export function imageContentType(bytes) {
  if (bytes.length > PNG_SIGNATURE.length && PNG_SIGNATURE.every((value, index) => bytes[index] === value)) return "image/png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

// 测评凭证（结果页/历史）或订单凭证（专属领取页）都能上传自己已生成的头像。
async function identity(env, request) {
  const testId = request.headers.get("x-pt-test-id");
  const token = request.headers.get("x-pt-token");
  if (testId && token) return `result:${(await authorize(env, testId, token)).tokenHash}`;
  const orderId = request.headers.get("x-pt-order-id");
  const orderToken = request.headers.get("x-pt-order-token");
  if (orderId && orderToken) return `order:${(await loadOrder(env, orderId, orderToken)).id}`;
  fail("TOKEN_INVALID", "图片凭证无效，请返回原页面重试", 401);
}

export const onRequestPost = ({ request, env }) => guarded(async () => {
  if (!env.PETI_KV) fail("SERVICE_NOT_CONFIGURED", "图片保存服务尚未开放，请稍后再试", 503);
  if (Number(request.headers.get("content-length")) > MAX_BYTES + 4096) {
    fail("IMAGE_TOO_LARGE", "图片过大，请稍后重试", 413);
  }
  if (!rateLimit(`save-image-ip:${clientIp(request)}`, 10)) {
    fail("RATE_LIMITED", "保存太频繁，请稍后再试", 429, true);
  }
  const owner = await identity(env, request);
  if (!rateLimit(`save-image-owner:${owner}`, 10)) {
    fail("RATE_LIMITED", "保存太频繁，请稍后再试", 429, true);
  }
  const declared = String(request.headers.get("content-type") || "").split(";")[0].trim();
  if (!["image/jpeg", "image/png"].includes(declared)) fail("IMAGE_INVALID", "图片格式无效");
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > MAX_BYTES) fail("IMAGE_TOO_LARGE", "图片过大，请稍后重试", 413);
  const type = imageContentType(bytes);
  if (!type || type !== declared) fail("IMAGE_INVALID", "图片格式无效");
  const id = crypto.randomUUID();
  await env.PETI_KV.put(`save-image:${id}`, bytes, { expirationTtl: TTL, metadata: { contentType: type } });
  // 后缀必须和内容一致：微信长按保存按后缀决定文件类型，没有后缀会存成 .unknown。
  const extension = type === "image/jpeg" ? "jpg" : "png";
  return json({ path: `/api/save-images/${id}.${extension}`, expiresIn: TTL }, 201);
});
