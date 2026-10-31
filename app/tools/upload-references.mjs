// 用法：node tools/upload-references.mjs [--remote | --check]；默认写 wrangler 本地 R2。
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PET_ROLE_FILES, referenceKey } from "../functions/lib/pet-role-references.js";

const app = fileURLToPath(new URL("../", import.meta.url));
const wrangler = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const remote = process.argv.includes("--remote");
const checkOnly = process.argv.includes("--check");
if (process.argv.slice(2).some((arg) => !["--remote", "--check"].includes(arg)) || (remote && checkOnly)) {
  throw new Error("用法：node tools/upload-references.mjs [--remote | --check]");
}

// 全部预检后才开始上传，避免缺图时只更新半套；不用 shell，直接传入中文路径。
const files = Object.entries(PET_ROLE_FILES).flatMap(([petType, roles]) => Object.entries(roles).map(([roleId, filename]) => {
  if (!/^[a-z]+$/.test(roleId) || /[/\\]/.test(filename)) throw new Error(`无效映射：${roleId}`);
  const file = fileURLToPath(new URL(`../../${petType === "dog" ? "free-pic-dog" : "free-pic"}/${filename}`, import.meta.url));
  const bytes = readFileSync(file);
  if (!bytes.length || bytes.length > 10 * 1024 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error(`参考图必须为不超过 10MB 的 PNG：${filename}`);
  }
  return { roleId, petType, file, key: referenceKey(petType, roleId) };
}));

if (!checkOnly) {
  for (const { roleId, petType, file, key } of files) {
    const result = spawnSync(process.execPath, [wrangler, "r2", "object", "put", `peti-custom-images/${key}`,
      "--file", file, "--content-type", "image/png", ...(remote ? [] : ["--local"])], { cwd: app, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`上传失败，停止同步：${petType}/${roleId}`);
    console.log(`已同步 ${petType}/${roleId}`);
  }
}
console.log(`${files.length} 张角色参考图${checkOnly ? "预检通过" : remote ? "已同步到远程 R2" : "已同步到本地 R2"}`);
