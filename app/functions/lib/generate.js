import { GENERATION_CONFIG } from "./generation-config.js";
import { fail } from "./custom.js";

export async function buildImageRequest(env, result, photo) {
  const form = new FormData();
  form.set("model", GENERATION_CONFIG.model);
  form.set("size", GENERATION_CONFIG.size);
  form.set("n", "1");
  form.set("output_format", "png");
  const fields = { petType: result.petType, roleId: result.roleId, petName: result.petName };
  form.set("prompt", GENERATION_CONFIG.prompt.replace(/\{(petType|roleId|petName)\}/g, (_, key) => fields[key]));
  const subject = await env.PETI_IMAGES.get(photo.object_key);
  if (!subject) fail("PHOTO_EXPIRED", "照片已不可用，请联系作者处理订单", 410);
  form.append("image[]", new Blob([await subject.arrayBuffer()], { type: "image/jpeg" }), "pet.jpg");
  if (GENERATION_CONFIG.referenceImageKeys.length > 15) fail("SERVICE_NOT_CONFIGURED", "定制素材配置有误", 503);
  for (const [index, key] of GENERATION_CONFIG.referenceImageKeys.entries()) {
    const object = await env.PETI_IMAGES.get(key);
    const type = object?.httpMetadata?.contentType;
    if (!object || !["image/png", "image/jpeg", "image/webp"].includes(type) || object.size > 10 * 1024 * 1024) fail("SERVICE_NOT_CONFIGURED", "定制参考图尚未就绪", 503);
    form.append("image[]", new Blob([await object.arrayBuffer()], { type }), `reference-${index}.${type === "image/jpeg" ? "jpg" : type.split("/")[1]}`);
  }
  return form;
}

export async function generateImage(env, form) {
  let response;
  try {
    response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST", headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: form, signal: AbortSignal.timeout(180_000),
    });
  } catch { return { status: "uncertain", retryable: false, errorCode: "GENERATION_UNCERTAIN" }; }
  if (!response.ok) return { status: "failed", retryable: response.status === 429 || response.status >= 500, errorCode: response.status === 429 ? "QUOTA_EXCEEDED" : "GENERATION_FAILED" };
  try {
    const payload = await response.json();
    const encoded = payload?.data?.[0]?.b64_json;
    if (typeof encoded !== "string" || encoded.length > 45_000_000) throw new Error("invalid output");
    const image = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    if (![137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => image[i] === byte)) throw new Error("invalid PNG");
    return { status: "ready", image };
  } catch { return { status: "uncertain", retryable: false, errorCode: "GENERATION_UNCERTAIN" }; }
}
