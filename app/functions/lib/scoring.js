// 计分与角色匹配（服务端唯一判定处，PRD-quiz §2/§3）
// 数据源即 public/data/quiz-*.json；balance-check.py 逻辑的 JS 对齐实现
import catQuiz from "../../public/data/quiz-cat.json";
import dogQuiz from "../../public/data/quiz-dog.json";

export const QUIZZES = { cat: catQuiz, dog: dogQuiz };
export const AXES = ["E", "A", "B", "D", "F", "C"];
export const AXIS_NAMES = { E: "电量", A: "贴贴", B: "胆量", D: "戏精", F: "干饭", C: "好奇" };

const OPTION_INDEX = new Map();
for (const quiz of Object.values(QUIZZES)) {
  for (const q of quiz.questions) {
    for (const o of q.options) OPTION_INDEX.set(o.id, o);
  }
}

export function isValidOptionId(oid) {
  return OPTION_INDEX.has(oid);
}

// 返回 { roleId, axes }；optionIds 非法时返回 null
export function scoreAnswers(quiz, optionIds) {
  const scores = {};
  for (const c of quiz.characters) scores[c.id] = 0;
  const axes = { E: 5, A: 5, B: 5, D: 5, F: 5, C: 5 };
  for (const oid of optionIds) {
    const o = OPTION_INDEX.get(oid);
    if (!o) return null;
    // 中庸选项（axis:null）不加属性分
    if (o.axis) axes[o.axis] += o.delta;
    for (const [cid, pts] of Object.entries(o.points || {})) scores[cid] += pts;
  }
  for (const a of AXES) axes[a] = Math.max(0, Math.min(10, axes[a]));
  const maxVal = Math.max(...Object.values(scores));
  const roleId = quiz.tieBreak.find((cid) => scores[cid] === maxVal);
  return { roleId, axes };
}

// 结果页/免费卡所需全部文案，按 petType 出后缀版
export function rolePayload(quiz, roleId) {
  const c = quiz.characters.find((x) => x.id === roleId);
  if (!c) return null;
  return {
    roleId: c.id,
    roleName: c.name,
    tagline: c.tagline,
    shortLines: c.shortLines,
    quote: c.quote,
    rarityPct: c.rarityPct,
  };
}
