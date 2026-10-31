import prompts from "./generation-prompts.js";
import { PET_ROLE_FILES, referenceKey } from "./pet-role-references.js";

export const GENERATION_CONFIG = {
  model: "doubao-seedream-5-0-flash-260915",
  size: "2048x2048", outputFormat: "png", watermark: false,
  // default 是未命中分角色 prompt 时的兜底；rolePrompts 由 tools/sync-generation-prompts.mjs 生成。
  prompts: { cat: prompts.cat.default, dog: prompts.dog.default },
  rolePrompts: { cat: prompts.cat.roles, dog: prompts.dog.roles },
  roleImageKeys: Object.fromEntries(Object.entries(PET_ROLE_FILES).map(([pet, roles]) =>
    [pet, Object.fromEntries(Object.keys(roles).map(role => [role, referenceKey(pet, role)]))])),
};

export function generationProfile(petType) {
  if (!["cat", "dog"].includes(petType)) return null;
  return {
    prompt: GENERATION_CONFIG.prompts[petType],
    rolePrompts: GENERATION_CONFIG.rolePrompts[petType] || {},
    roleImageKeys: GENERATION_CONFIG.roleImageKeys[petType],
  };
}

// 仅由下单接口写入；模型与素材配置在本单内固定，不接受浏览器覆盖。
export function generationSnapshot(result) {
  const profile = generationProfile(result.petType);
  const rolePrompt = profile?.rolePrompts?.[result.roleId];
  return {
    prompt: rolePrompt || profile?.prompt,
    promptId: rolePrompt ? `${result.petType}:${result.roleId}` : `${result.petType}:default`,
    referenceKey: profile?.roleImageKeys?.[result.roleId],
    model: GENERATION_CONFIG.model, size: GENERATION_CONFIG.size,
    outputFormat: GENERATION_CONFIG.outputFormat, watermark: GENERATION_CONFIG.watermark,
  };
}
