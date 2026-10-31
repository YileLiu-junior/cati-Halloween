import cat from "./role-references.js";
import dog from "./dog-role-references.js";

export const PET_ROLE_FILES = { cat, dog };
export const REFERENCE_VERSION = "20261030-v2";
export function referenceKey(petType, roleId) {
  return Object.hasOwn(PET_ROLE_FILES, petType) && Object.hasOwn(PET_ROLE_FILES[petType], roleId)
    ? `references/${REFERENCE_VERSION}/${petType}/${roleId}.png` : null;
}
