import { fail, guarded, privateImage, readPhoto, requireStorage } from "../../lib/custom.js";
import { sha256Hex } from "../../lib/api.js";

export const onRequestGet = ({ request, env, params }) => guarded(async () => {
  requireStorage(env);
  const token = request.headers.get("X-PT-Token");
  if (!token) fail("TOKEN_INVALID", "照片凭证无效", 401);
  const photo = await readPhoto(env, params.photoId, await sha256Hex(token));
  const object = await env.PETI_IMAGES.get(photo.object_key);
  if (!object) fail("PHOTO_EXPIRED", "照片已过期，请重新上传", 410);
  return privateImage(object.body, "image/jpeg");
});
