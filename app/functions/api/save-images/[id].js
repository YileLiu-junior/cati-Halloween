import { fail, guarded } from "../../lib/custom.js";
import { imageContentType } from "../save-images.js";

const UUID = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\.(?:png|jpg))?$/i;

async function serve(env, params, withBody) {
  if (!env.PETI_KV) fail("SERVICE_NOT_CONFIGURED", "图片保存服务尚未开放", 503);
  const match = UUID.exec(params.id || "");
  if (!match) fail("NOT_FOUND", "图片不存在或已过期", 404);
  const value = await env.PETI_KV.get(`save-image:${match[1]}`, { type: "arrayBuffer" });
  if (!value) fail("NOT_FOUND", "图片不存在或已过期", 404);
  const bytes = new Uint8Array(value);
  const type = imageContentType(bytes) || "application/octet-stream";
  const extension = type === "image/jpeg" ? "jpg" : "png";
  return new Response(withBody ? bytes : null, {
    headers: {
      "content-type": type,
      "content-disposition": `inline; filename="peti-avatar.${extension}"`,
      "cache-control": "public, max-age=86400",
      "x-content-type-options": "nosniff",
    },
  });
}

export const onRequestGet = ({ env, params }) => guarded(() => serve(env, params, true));
export const onRequestHead = ({ env, params }) => guarded(() => serve(env, params, false));
