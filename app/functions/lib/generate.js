import { GENERATION_CONFIG, generationSnapshot } from "./generation-config.js";
import { fail } from "./custom.js";
import { inspectPng } from "./png-header.js";

// 仅缓存公共角色参考图；每个存储绑定最多4项、10MiB，照片不进入缓存。
const referenceCaches = new WeakMap();
async function referenceDataUri(storage, key) {
  let cache = referenceCaches.get(storage);
  if (!cache) { cache = new Map(); referenceCaches.set(storage, cache); }
  const cached = cache.get(key);
  if (cached?.expires > Date.now()) return cached.uri;
  cache.delete(key);
  const object = await storage.get(key);
  const type = object?.httpMetadata?.contentType;
  if (!object || !["image/png", "image/jpeg", "image/webp"].includes(type)) fail("SERVICE_NOT_CONFIGURED", "定制参考图尚未就绪", 503);
  const uri = await dataUri(object, type);
  if (uri.length <= 10 * 1024 * 1024) {
    while (cache.size && (cache.size >= 4 || [...cache.values()].reduce((total, item) => total + item.uri.length, 0) + uri.length > 10 * 1024 * 1024)) cache.delete(cache.keys().next().value);
    cache.set(key, { uri, expires: Date.now() + 300_000 });
  }
  return uri;
}

// Seedream 5.0 Flash：image[0]＝用户照片（图1），image[1]＝订单所选角色的参考图（图2）。
export async function buildImageRequest(env, result, photo) {
  const profile = result.generation || generationSnapshot(result);
  const referenceKey = profile.referenceKey;
  if (!referenceKey || !profile.prompt?.trim()) fail("SERVICE_NOT_CONFIGURED", "该角色的定制素材尚未就绪", 503);
  const [subject, reference] = await Promise.all([env.PETI_IMAGES.get(photo.object_key), referenceDataUri(env.PETI_IMAGES, referenceKey)]);
  if (!subject) fail("PHOTO_EXPIRED", "照片已不可用，请联系作者处理订单", 410);
  const fields = { petType: result.petType, roleId: result.roleId, petName: result.petName };
  return {
    prompt: profile.prompt.replace(/\{(petType|roleId|petName)\}/g, (_, key) => fields[key]),
    images: [await dataUri(subject, "image/jpeg"), reference],
    settings: profile,
  };
}

async function dataUri(object, type) {
  return bytesDataUri(new Uint8Array(await object.arrayBuffer()), type);
}

function bytesDataUri(bytes, type) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return `data:${type};base64,${btoa(binary)}`;
}

export async function generateImage(env, request, { onEvent } = {}) {
  let response;
  const settings = request.settings || GENERATION_CONFIG;
  try {
    await onEvent?.({ stage: "calling" });
    response = await fetch("https://ark.cn-beijing.volces.com/api/v3/images/generations", {
      method: "POST",
      headers: { authorization: `Bearer ${env.ARK_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: settings.model,
        prompt: request.prompt,
        image: request.images,
        size: settings.size,
        output_format: settings.outputFormat,
        response_format: "b64_json",
        stream: false,
        // 直接交付模型出图，保留白底与涂鸦，不做图层拆分或透明处理。
        watermark: settings.watermark,
      }),
      signal: AbortSignal.timeout(180_000),
    });
    await onEvent?.({ stage: "response", httpStatus: response.status,
      requestId: response.headers.get("x-request-id") || response.headers.get("x-tt-logid") || response.headers.get("request-id") });
  } catch { return { status: "uncertain", retryable: false, errorCode: "GENERATION_UNCERTAIN" }; }
  if (!response.ok) return { status: "failed", retryable: response.status === 429 || response.status >= 500, errorCode: response.status === 429 ? "QUOTA_EXCEEDED" : "GENERATION_FAILED" };
  try {
    const payload = await response.json();
    if (payload.error || !Array.isArray(payload.data) || payload.data.length !== 1 || payload.data[0].error) throw new Error("invalid output");
    const encoded = payload.data[0].b64_json;
    const { bytes: image, width, height } = inspectPng(encoded);
    if (`${width}x${height}` !== settings.size) throw new Error("unexpected size");
    return { status: "ready", image, imageType: "image/png", imageExt: "png" };
  } catch { return { status: "uncertain", retryable: false, errorCode: "GENERATION_UNCERTAIN" }; }
}
