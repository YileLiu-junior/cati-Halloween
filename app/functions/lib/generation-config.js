import prompts from "./generation-prompts.js";
import { PET_ROLE_FILES, referenceKey } from "./pet-role-references.js";

export const GENERATION_CONFIG = {
  model: "doubao-seedream-5-0-flash-260915",
  size: "2048x2048", outputFormat: "png", watermark: false,
  prompts,
  roleImageKeys: Object.fromEntries(Object.entries(PET_ROLE_FILES).map(([pet, roles]) =>
    [pet, Object.fromEntries(Object.keys(roles).map(role => [role, referenceKey(pet, role)]))])),
};

export function generationProfile(petType) {
  if (!["cat", "dog"].includes(petType)) return null;
  return { prompt: GENERATION_CONFIG.prompts[petType], roleImageKeys: GENERATION_CONFIG.roleImageKeys[petType] };
}

// 仅由下单接口写入；模型与素材配置在本单内固定，不接受浏览器覆盖。
export function generationSnapshot(result) {
  const profile = generationProfile(result.petType);
  return { prompt: profile?.prompt, referenceKey: profile?.roleImageKeys?.[result.roleId], model: GENERATION_CONFIG.model,
    size: GENERATION_CONFIG.size, outputFormat: GENERATION_CONFIG.outputFormat, watermark: GENERATION_CONFIG.watermark };
}
