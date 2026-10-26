// localStorage 状态（PRD §4.2：匿名ID/渠道/testId/题目版本/选项顺序/答案/宠物名/结果/口令）
// 单键 blob，命名空间 peti:v1；不作任何权益依据
const KEY = "peti:v1";

export function getState() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

export function setState(patch) {
  const next = { ...getState(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function initState() {
  const s = getState();
  const patch = {};
  if (!s.anonId) patch.anonId = crypto.randomUUID();
  localStorage.setItem(KEY, JSON.stringify({ ...s, ...patch }));
  return getState();
}

// 恢复链接/渠道参数：先消费再剥离（posthog-proxy-setup §3，口令片段不进埋点）
export function consumeSourceParam() {
  const params = new URLSearchParams(location.search);
  const source = params.get("source") || "";
  if (location.search || location.hash) {
    history.replaceState(null, "", location.pathname);
  }
  return source;
}

// Fisher-Yates；每题仅洗一次，顺序入 localStorage 后会话内不再变（PRD §3.2/§3.3）
export function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function petNameCodePoints(name) {
  return [...name].length;
}

export async function fetchQuiz(petType) {
  const res = await fetch(`/data/quiz-${petType}.json`);
  if (!res.ok) throw new Error("quiz data fetch failed");
  return res.json();
}
