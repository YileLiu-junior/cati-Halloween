export const ROLE_ASSET_VERSION = "20261030-v2";
const pet = value => {
  if (!["cat", "dog"].includes(value)) throw new Error("未知宠物类型");
  return value;
};
export const roleCardUrl = (petType, roleId) => `/static-cards/${ROLE_ASSET_VERSION}/${pet(petType)}/${encodeURIComponent(roleId)}.webp`;
export const roleAtlasUrl = petType => `/role-thumbnails/${ROLE_ASSET_VERSION}/${pet(petType)}/atlas.webp`;
