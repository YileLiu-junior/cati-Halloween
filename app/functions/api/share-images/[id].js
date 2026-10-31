import { fail, guarded } from "../../lib/custom.js";

// 微信（尤其是安卓）保存图片时会用 URL 后缀决定缓存文件类型；
// 没有后缀会被当成 .unknown 而提示“保存失败”，所以地址统一带 .png。
const UUID = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\.png)?$/i;

async function serve(env, params, withBody) {
  if (!env.PETI_KV) fail("SERVICE_NOT_CONFIGURED", "分享图片服务尚未开放", 503);
  const match = UUID.exec(params.id || "");
  if (!match) fail("NOT_FOUND", "分享图片不存在或已过期", 404);
  const bytes = await env.PETI_KV.get(`share-image:${match[1]}`, { type: "arrayBuffer" });
  if (!bytes) fail("NOT_FOUND", "分享图片不存在或已过期", 404);
  // 公开可读，微信原生长按保存需要不带鉴权的稳定 https 地址。
  return new Response(withBody ? bytes : null, {
    headers: {
      "content-type": "image/png",
      "content-disposition": 'inline; filename="peti-share.png"',
      "cache-control": "public, max-age=604800",
      "x-content-type-options": "nosniff",
    },
  });
}

export const onRequestGet = ({ env, params }) => guarded(() => serve(env, params, true));
// 部分微信版本会先探测 HEAD；不处理时会落到站点回退页（HTML 200），导致保存失败。
export const onRequestHead = ({ env, params }) => guarded(() => serve(env, params, false));
