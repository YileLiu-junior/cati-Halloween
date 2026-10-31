import { fail } from "./custom.js";

const encode = bytes => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const decode = text => Uint8Array.from(atob(text.replaceAll("-", "+").replaceAll("_", "/")), char => char.charCodeAt(0));
async function key(env) {
  if (!env.ORDER_ACCESS_SECRET || env.ORDER_ACCESS_SECRET.length < 32) fail("SERVICE_NOT_CONFIGURED", "订单找回服务尚未配置", 503);
  return crypto.subtle.importKey("raw", new TextEncoder().encode(env.ORDER_ACCESS_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
export async function orderAccessToken(env, order) {
  const payload = encode(new TextEncoder().encode(JSON.stringify({ id: order.id, v: order.link_version, exp: Math.max(order.expires_at, order.created_at + 90 * 86_400_000) })));
  const signature = encode(new Uint8Array(await crypto.subtle.sign("HMAC", await key(env), new TextEncoder().encode(payload))));
  return `a1.${payload}.${signature}`;
}
export async function verifyOrderAccess(env, order, token) {
  if (typeof token !== "string" || token.length > 800 || !token.startsWith("a1.")) return false;
  try {
    const [, payload, signature, extra] = token.split(".");
    if (extra || !payload || !signature) return false;
    if (!await crypto.subtle.verify("HMAC", await key(env), decode(signature), new TextEncoder().encode(payload))) return false;
    const data = JSON.parse(new TextDecoder().decode(decode(payload)));
    return data.id === order.id && data.v === order.link_version && data.exp > Date.now();
  } catch { return false; }
}
export async function avatarOrderUrl(env, order) {
  const origin = new URL(env.PETI_PUBLIC_ORIGIN);
  if (origin.protocol !== "https:" && origin.hostname !== "localhost" && origin.hostname !== "127.0.0.1") throw new Error("Invalid PETI_PUBLIC_ORIGIN");
  const url = new URL("/avatar.html", origin.origin);
  url.hash = new URLSearchParams({ order: order.id, access: await orderAccessToken(env, order) }).toString();
  return url.href;
}
