import { GENERATION_CONFIG } from "./generation-config.js";
import { fail } from "./custom.js";
import { composeTransparentLayers, decodePng } from "./transparent-png.js";

// Seedream 5.0 Flash：image[0]＝用户照片（图1），image[1]＝订单所选角色的参考图（图2）。
export async function buildImageRequest(env, result, photo) {
  const referenceKey = GENERATION_CONFIG.roleImageKeys[result.roleId];
  if (!referenceKey) fail("SERVICE_NOT_CONFIGURED", "该角色的定制素材尚未就绪", 503);
  const subject = await env.PETI_IMAGES.get(photo.object_key);
  if (!subject) fail("PHOTO_EXPIRED", "照片已不可用，请联系作者处理订单", 410);
  const reference = await env.PETI_IMAGES.get(referenceKey);
  const referenceType = reference?.httpMetadata?.contentType;
  if (!reference || !["image/png", "image/jpeg", "image/webp"].includes(referenceType)) fail("SERVICE_NOT_CONFIGURED", "定制参考图尚未就绪", 503);
  const fields = { petType: result.petType, roleId: result.roleId, petName: result.petName };
  return {
    prompt: GENERATION_CONFIG.prompt.replace(/\{(petType|roleId|petName)\}/g, (_, key) => fields[key]),
    images: [await dataUri(subject, "image/jpeg"), await dataUri(reference, referenceType)],
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

export async function generateImage(env, request) {
  let response;
  try {
    response = await fetch("https://ark.cn-beijing.volces.com/api/v3/images/generations", {
      method: "POST",
      headers: { authorization: `Bearer ${env.ARK_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: GENERATION_CONFIG.model,
        prompt: request.prompt,
        image: request.images,
        size: GENERATION_CONFIG.size,
        output_format: GENERATION_CONFIG.outputFormat,
        response_format: "b64_json",
        stream: false,
        // 原生 transparent 只接受单张带 alpha 的输入图；双图生图后使用图层拆分抠图。
        watermark: GENERATION_CONFIG.watermark,
      }),
      signal: AbortSignal.timeout(180_000),
    });
  } catch { return { status: "uncertain", retryable: false, errorCode: "GENERATION_UNCERTAIN" }; }
  if (!response.ok) return { status: "failed", retryable: response.status === 429 || response.status >= 500, errorCode: response.status === 429 ? "QUOTA_EXCEEDED" : "GENERATION_FAILED" };
  try {
    const payload = await response.json();
    if (payload.error || !Array.isArray(payload.data) || payload.data.length !== 1 || payload.data[0].error) throw new Error("invalid output");
    const encoded = payload.data[0].b64_json;
    const { bytes: image, width, height } = decodePng(encoded);
    if (`${width}x${height}` !== GENERATION_CONFIG.size) throw new Error("unexpected size");
    return { status: "ready", image, imageType: "image/png", imageExt: "png" };
  } catch { return { status: "uncertain", retryable: false, errorCode: "GENERATION_UNCERTAIN" }; }
}

export async function removeBackground(env, image) {
  try {
    const response = await fetch("https://ark.cn-beijing.volces.com/api/v3/images/generations", {
      method: "POST",
      headers: { authorization: `Bearer ${env.ARK_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: GENERATION_CONFIG.model,
        prompt: "将完整的潮玩手办角色提取为一个独立的透明前景图层。角色的服装、帽子、耳朵、爪子、尾巴、配饰、手持道具及紧邻的角色道具全部属于同一个前景，不要拆成多个图层。只分离背景，不改变角色的形象、颜色、表情、姿势、材质和光影，不添加文字或水印。",
        image: bytesDataUri(image, "image/png"),
        layer_decomposition: true,
        size: "2K",
        output_format: "png",
        response_format: "b64_json",
        stream: false,
        watermark: GENERATION_CONFIG.watermark,
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!response.ok) throw new Error("cutout failed");
    const [width, height] = GENERATION_CONFIG.size.split("x").map(Number);
    const output = composeTransparentLayers(await response.json(), width, height);
    return { status: "ready", image: output, imageType: "image/png", imageExt: "png" };
  } catch {
    // 原图已经生成，抠图失败不得重跑整单，避免重复产生生图费用。
    return { status: "uncertain", retryable: false, errorCode: "CUTOUT_UNCERTAIN" };
  }
}
