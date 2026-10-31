import { fail, guarded } from "../../lib/custom.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const onRequestGet = ({ env, params }) => guarded(async () => {
  if (!env.PETI_KV) fail("SERVICE_NOT_CONFIGURED", "分享图片服务尚未开放", 503);
  if (!UUID.test(params.id || "")) fail("NOT_FOUND", "分享图片不存在或已过期", 404);
  const bytes = await env.PETI_KV.get(`share-image:${params.id}`, { type: "arrayBuffer" });
  if (!bytes) fail("NOT_FOUND", "分享图片不存在或已过期", 404);
  // 公开可读，微信原生长按保存需要不带鉴权的稳定 https 地址。
  return new Response(bytes, {
    headers: {
      "content-type": "image/png",
      "content-disposition": 'inline; filename="peti-share.png"',
      "cache-control": "public, max-age=604800",
      "x-content-type-options": "nosniff",
    },
  });
});
