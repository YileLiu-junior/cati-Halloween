export const ROLE_ASSET_VERSION = "20261030-v2";
const pet = value => {
  if (!["cat", "dog"].includes(value)) throw new Error("未知宠物类型");
  return value;
};
export const roleCardUrl = (petType, roleId) => `/static-cards/${ROLE_ASSET_VERSION}/${pet(petType)}/${encodeURIComponent(roleId)}.webp`;
// 大图查看与长按保存使用 JPG，展示与预取继续用 WebP。
export const roleCardJpgUrl = (petType, roleId) => `/static-cards/${ROLE_ASSET_VERSION}/${pet(petType)}/${encodeURIComponent(roleId)}.jpg`;
export const roleAtlasUrl = petType => `/role-thumbnails/${ROLE_ASSET_VERSION}/${pet(petType)}/atlas.webp`;
// 历史列表用的小图：312×320、约 20–30KB，不拉整张角色卡。
export const roleThumbUrl = (petType, roleId) => `/role-thumbnails/${ROLE_ASSET_VERSION}/${pet(petType)}/${encodeURIComponent(roleId)}.webp`;
