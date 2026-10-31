import { readFileSync, writeFileSync } from "node:fs";

const prompts = Object.fromEntries(["cat", "dog"].map(pet => {
  const filename = pet === "cat" ? "pet-character.md" : "pet-character-dog.md";
  const prompt = readFileSync(new URL(`../../doc/prompts/${filename}`, import.meta.url), "utf8").trim().replaceAll("\r\n", "\n");
  if (!prompt) throw new Error(`Prompt 不能为空：${filename}`);
  return [pet, prompt];
}));
writeFileSync(new URL("../functions/lib/generation-prompts.js", import.meta.url), `// 由 tools/sync-generation-prompts.mjs 从 doc/prompts 生成。\nexport default ${JSON.stringify(prompts, null, 2)};\n`);
console.log("猫狗 Prompt 已同步到服务端配置");
