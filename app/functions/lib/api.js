// 接口公共件：统一错误、哈希、随机 ID、内存限流（PRD-quiz §7）
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

// PRD §7.3：错误统一 { code, message, retryable }，前端按 code 处理
export function apiError(code, message, status, retryable = false) {
  return json({ code, message, retryable }, status);
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 128 位随机口令 → 32 hex（interaction-design §2 找回凭证口径）
export function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// testId：随机 UUID，不可枚举（复审质询 1 备注项）
export function randomTestId() {
  return crypto.randomUUID();
}

const PUBLIC_ID_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
// publicId：8 字符高熵随机直接写入（复审质询 3：加熵不加索引）
export function randomPublicId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => PUBLIC_ID_ALPHABET[b % PUBLIC_ID_ALPHABET.length]).join("");
}

// PRD §7.1：限流用实例内存近似、不占 KV 写额（多实例下不精确，活动量级够用）
const buckets = new Map();
export function rateLimit(key, limit = 30, windowMs = 60_000) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now - b.start > windowMs) {
    buckets.set(key, { start: now, count: 1 });
    return true;
  }
  b.count += 1;
  return b.count <= limit;
}

export function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || "local-dev";
}

export function petNameCodePoints(name) {
  return [...name].length; // 按 Unicode 码点计，与前端同口径（PRD §5.2）
}
