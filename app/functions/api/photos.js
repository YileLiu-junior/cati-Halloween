import { clientIp, rateLimit } from "../lib/api.js";
import { authorize, fail, guarded, jpegDimensions, PHOTO_TTL, privateJson, requireStorage } from "../lib/custom.js";

export const onRequestPost = ({ request, env }) => guarded(async () => {
  requireStorage(env);
  if (Number(request.headers.get("content-length")) > 2_200_000) fail("PHOTO_INVALID", "上传照片不能超过 2MB", 413);
  if (!rateLimit(`photo-ip:${clientIp(request)}`, 3)) fail("RATE_LIMITED", "上传太频繁，请一分钟后重试", 429, true);
  const form = await request.formData().catch(() => null);
  const testId = form?.get("testId");
  const { tokenHash } = await authorize(env, testId, form?.get("token"));
  if (!rateLimit(`photo-token:${tokenHash}`, 3)) fail("RATE_LIMITED", "上传太频繁，请一分钟后重试", 429, true);
  if (form.get("consent") !== "true") fail("CONSENT_REQUIRED", "请先同意照片使用说明");
  const file = form.get("photo");
  if (!file || typeof file.arrayBuffer !== "function" || file.type !== "image/jpeg" || file.size > 2 * 1024 * 1024 || !file.size) fail("PHOTO_INVALID", "请选择一张有效的宠物照片");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const dimensions = jpegDimensions(bytes);
  if (!dimensions || Math.min(dimensions.width, dimensions.height) < 512 || Math.max(dimensions.width, dimensions.height) > 1600) fail("PHOTO_INVALID", "照片短边需至少 512px，长边不超过 1600px");
  const photoId = crypto.randomUUID();
  const key = `photos/${testId}/${photoId}.jpg`;
  const expiresAt = Date.now() + PHOTO_TTL;
  await env.PETI_IMAGES.put(key, bytes, { httpMetadata: { contentType: "image/jpeg" } });
  try {
    await env.PETI_DB.prepare("INSERT INTO photos (id, test_id, token_hash, object_key, expires_at) VALUES (?, ?, ?, ?, ?)").bind(photoId, testId, tokenHash, key, expiresAt).run();
  } catch (error) { await env.PETI_IMAGES.delete(key); throw error; }
  return privateJson({ photoId, expiresAt: new Date(expiresAt).toISOString() }, 201);
});
