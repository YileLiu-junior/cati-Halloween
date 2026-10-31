// 从 doc/prompts 生成服务端 Prompt JSON 仓库。
// 猫：combined/NN-role.txt，每角色一份完整 prompt；
// 狗：dog-roles/<role>.md，每角色一份完整 prompt。
// 两份都按多图融合接口约定使用“图1/图2”：
// 图1 = image[0] 用户宠物照片，图2 = image[1] 角色参考图。
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import catRoleFiles from "../functions/lib/role-references.js";
import dogRoleFiles from "../functions/lib/dog-role-references.js";

const read = (url) => readFileSync(url, "utf8").trim().replaceAll("\r\n", "\n");
function promptFrom(url, label) {
  const prompt = read(url);
  if (!prompt) throw new Error(`Prompt 不能为空：${label}`);
  if (/图[一二]/.test(prompt)) throw new Error(`${label} 仍在使用“图一/图二”，请改成多图融合约定的“图1/图2”`);
  return prompt;
}

function buildRoles(roleIds, resolveUrl, label) {
  if (roleIds.length !== 16) throw new Error(`${label} 角色数量应为 16，实际 ${roleIds.length}`);
  return Object.fromEntries(roleIds.map((role) => {
    const url = resolveUrl(role);
    if (!url) throw new Error(`${label} 缺少角色 Prompt：${role}`);
    return [role, promptFrom(url, `${label}/${role}`)];
  }));
}

const catDefault = promptFrom(new URL("../../doc/prompts/pet-character.md", import.meta.url), "pet-character.md");
const dogDefault = promptFrom(new URL("../../doc/prompts/pet-character-dog.md", import.meta.url), "pet-character-dog.md");

const catDir = new URL("../../doc/prompts/cat-roles/combined/", import.meta.url);
const catFiles = new Map();
for (const name of readdirSync(catDir)) {
  const match = /^(\d{2})-([a-z]+)\.txt$/.exec(name);
  if (!match) continue;
  if (catFiles.has(match[2])) throw new Error(`猫角色 Prompt 重复：${match[2]}`);
  catFiles.set(match[2], name);
}
const catRoleIds = Object.keys(catRoleFiles);
for (const role of catFiles.keys()) {
  if (!catRoleIds.includes(role)) throw new Error(`cat-roles/combined 出现未登记角色：${role}`);
}
const catRoles = buildRoles(catRoleIds, (role) => {
  const name = catFiles.get(role);
  return name ? new URL(name, catDir) : null;
}, "cat-roles/combined");

const dogDir = new URL("../../doc/prompts/dog-roles/", import.meta.url);
const dogRoleIds = Object.keys(dogRoleFiles);
const dogFiles = new Set(readdirSync(dogDir)
  .filter((name) => /^[a-z]+\.md$/.test(name))
  .map((name) => name.slice(0, -3)));
for (const role of dogFiles) {
  if (!dogRoleIds.includes(role)) throw new Error(`dog-roles 出现未登记角色：${role}`);
}
const dogRoles = buildRoles(dogRoleIds, (role) => dogFiles.has(role) ? new URL(`${role}.md`, dogDir) : null, "dog-roles");

const repository = {
  schemaVersion: 1,
  // 请求体 image 数组的顺序即 prompt 中图号的顺序。
  imageOrder: ["图1 = 用户宠物照片（image[0]）", "图2 = 角色参考图（image[1]）"],
  cat: { default: catDefault, roles: catRoles },
  dog: { default: dogDefault, roles: dogRoles },
};

const json = `${JSON.stringify(repository, null, 2)}\n`;
writeFileSync(new URL("../functions/lib/generation-prompts.json", import.meta.url), json);
// Wrangler 3 的 esbuild 不支持 JSON import attributes，运行时使用这份从 JSON 复制的 ESM 镜像。
writeFileSync(new URL("../functions/lib/generation-prompts.js", import.meta.url),
  `// 由 tools/sync-generation-prompts.mjs 从 generation-prompts.json 生成，请勿手改。\nexport default ${JSON.stringify(repository)};\n`);
console.log(`Prompt JSON 已同步：猫 ${Object.keys(catRoles).length} 个角色，狗 ${Object.keys(dogRoles).length} 个角色`);
