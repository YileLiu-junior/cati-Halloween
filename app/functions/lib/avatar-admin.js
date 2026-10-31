import { fail } from "./custom.js";
import { sha256Hex } from "./api.js";
export async function authorizeAdmin(env, request) {
  if (!env.AVATAR_ADMIN_SECRET || env.AVATAR_ADMIN_SECRET.length < 32) fail("SERVICE_NOT_CONFIGURED", "售后管理尚未配置", 503);
  const token = request.headers.get("Authorization")?.replace(/^Bearer /, "");
  if (!token || token.length > 200) fail("TOKEN_INVALID", "管理凭证无效", 401);
  const actual = await sha256Hex(token), expected = await sha256Hex(env.AVATAR_ADMIN_SECRET);
  let mismatch = 0;
  for (let i = 0; i < actual.length; i++) mismatch |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  if (mismatch) fail("TOKEN_INVALID", "管理凭证无效", 401);
}
