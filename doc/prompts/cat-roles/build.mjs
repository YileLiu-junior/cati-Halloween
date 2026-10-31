// 合成猫角色分角色 prompt：shared.md + NN-role.md → combined/NN-role.txt，并生成 REVIEW.md。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL("./", import.meta.url));
const roles = [
  ["ghost", "小幽灵咪"], ["zombie", "小僵尸咪"], ["chainsaw", "电锯咪"], ["mummy", "木乃伊咪"],
  ["nurse", "小管家咪"], ["vampire", "吸血鬼咪"], ["franken", "科学怪咪"], ["pirate", "海盗咪"],
  ["clown", "小鬼咪"], ["bride", "月光新娘咪"], ["witch", "女巫咪"], ["pumpkin", "南瓜咪"],
  ["werewolf", "狼人咪"], ["bat", "蝙蝠咪"], ["gargoyle", "贪睡财神咪"], ["pharaoh", "法老咪"],
];
const notes = {
  ghost: "白色床单完整覆盖整张脸，只剪三个小洞（左眼、右眼、鼻嘴），洞间保留明显白色布带；不要照搬图二大脸开口。",
  zombie: "保留官帽、符纸、朝珠和布靴；尾巴改为纯黑，禁止参考图灰环纹。",
  chainsaw: "补回参考图的彩绘妆（黑眉、红泪痕、脸颊螺旋、额头划痕），尾巴去环纹。",
  mummy: "绷带露出完整五官；去掉参考图的木箱、南瓜和糖果，尾巴去环纹。",
  nurse: "围裙血迹、南瓜徽章、骷髅灯；尾巴纯黑，虹膜用深橄榄绿。",
  vampire: "斗篷、金杯、尖牙；尾巴纯黑，禁止灰虎斑。",
  franken: "重点补黑色粗缝线（脸、爪、尾）+ 淡紫补丁 + 金属螺栓。",
  pirate: "眼罩、钩子、弯刀、羽毛帽；尾巴纯黑。",
  clown: "重点锁定黑白身份，禁止灰虎斑额头/脸颊/身体；补眨眼吐舌。",
  bride: "蕾丝头纱、蓝玫瑰、破旧蕾丝裙、蝴蝶；尾巴纯黑。",
  witch: "针织帽、紫披肩、魔杖、魔法书、小蝙蝠；保持漂浮姿势，尾巴纯黑。",
  pumpkin: "南瓜头套、啃南瓜、四只脚；尾巴纯黑。",
  werewolf: "重点锁定黑白身份：灰色只属于狼头兜帽，禁止灰虎斑脸/身体/环纹尾。",
  bat: "三花参考图只取骷髅衣、翅膀和妆容，猫本体保持黑白；尾巴纯黑。",
  gargoyle: "重点：只露一只前爪+一条后腿、闭眼睡觉、素红棉布垫。",
  pharaoh: "蓝金头饰、宽项圈、趴卧两前爪；尾巴纯黑。",
};

const shared = (await readFile(join(here, "shared.md"), "utf8")).trim();
await mkdir(join(here, "combined"), { recursive: true });

let review = `# 猫咪分角色 Prompt 集\n\n`;
review += `最终发给模型的 prompt = \`shared.md\` + \`【角色专属要求】\` + \`NN-role.md\`。\n`;
review += `每次只替换角色专属段，共享身份规则保持一致。合成后的完整 prompt 在 \`combined/NN-role.txt\`。\n\n`;
review += `## 共享身份底稿（shared.md）\n\n\`\`\`text\n${shared}\n\`\`\`\n\n`;

const rows = [];
for (const [index, [role, name]] of roles.entries()) {
  const nn = String(index + 1).padStart(2, "0");
  const roleText = (await readFile(join(here, `${nn}-${role}.md`), "utf8")).trim();
  const combined = `${shared}\n\n【角色专属要求】\n\n${roleText}\n`;
  await writeFile(join(here, "combined", `${nn}-${role}.txt`), combined);
  rows.push(`| ${nn} | ${role} | ${name} | ${notes[role]} |`);
  review += `## ${nn} · ${name}（${role}）\n\n`;
  review += `> 本轮修正：${notes[role]}\n\n`;
  review += `\`\`\`text\n${roleText}\n\`\`\`\n\n`;
}

review += `## 逐角色修正索引\n\n| # | 角色 ID | 名称 | 本轮修正 |\n|---|---------|------|----------|\n${rows.join("\n")}\n\n`;
review += `## 文件\n\n- \`shared.md\`：共享身份/材质/构图规则\n- \`NN-role.md\`：16 份角色专属段\n- \`combined/NN-role.txt\`：可直接用于 \`--prompt-file\` 的完整 prompt\n- \`REVIEW.md\`：本文件，由 \`node build.mjs\` 生成\n`;
await writeFile(join(here, "REVIEW.md"), review);
console.log(`已生成 16 份 combined prompt 和 REVIEW.md（${join(here, "REVIEW.md")}）`);
