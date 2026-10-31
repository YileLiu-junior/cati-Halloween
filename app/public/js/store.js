import { roleCardUrl, roleAtlasUrl } from "./role-assets.js";
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
  if (patch.result && next.testId) {
    const history = getHistory().reverse();
    const index = history.findIndex((entry) => entry.testId === next.testId);
    const saved = resultEntry(next, history[index]);
    saved.completedAt ||= new Date().toISOString();
    if (index === -1) history.push(saved);
    else history[index] = saved;
    next.history = history;
  }
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

// 历史只保存结果和自动找回凭证，查看旧结果不改当前答题会话。
function resultEntry(entry, previous = {}) {
  return {
    testId: entry.testId,
    token: entry.token || previous.token,
    petName: entry.petName || entry.result.petName,
    petType: entry.petType || entry.result.petType,
    quizVersion: entry.quizVersion || entry.result.quizVersion,
    result: entry.result,
    completedAt: entry.completedAt || previous.completedAt || null,
  };
}

export function getHistory() {
  const state = getState();
  const entries = new Map();
  for (const entry of [...(Array.isArray(state.history) ? state.history : []), state]) {
    if (!entry?.testId || !entry.result) continue;
    entries.set(entry.testId, resultEntry(entry, entries.get(entry.testId)));
  }
  return [...entries.values()].reverse();
}

export function getResult(testId) {
  return getHistory().find((entry) => entry.testId === testId);
}

export function saveResult(entry) {
  if (!entry?.testId || !entry.result) return null;
  const history = getHistory().reverse();
  const index = history.findIndex((item) => item.testId === entry.testId);
  const saved = resultEntry(entry, history[index]);
  saved.completedAt ||= new Date().toISOString();
  if (index === -1) history.push(saved);
  else history[index] = saved;
  setState({ history });
  return saved;
}

export function renameResult(testId, name) {
  const len = petNameCodePoints(name);
  if (len < 1 || len > 12) throw new Error("名字限 1–12 字");
  const entry = getResult(testId);
  if (!entry) return null;
  const updated = { ...entry, petName: name, result: { ...entry.result, petName: name } };
  if (getState().testId === testId) setState({ petName: name, result: updated.result });
  return saveResult(updated);
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

// 旧会话兼容：题库新增选项后，把已存顺序补齐为新题的完整选项集
export function completeOptionOrder(question, savedOrder) {
  const all = question.options.map((o) => o.id);
  const saved = Array.isArray(savedOrder) ? savedOrder.filter((id) => all.includes(id)) : [];
  const missing = all.filter((id) => !saved.includes(id));
  return { order: [...saved, ...missing], changed: missing.length > 0 || saved.length !== (savedOrder?.length || 0) };
}

export function petNameCodePoints(name) {
  return [...name].length;
}

export async function fetchQuiz(petType) {
  const version = globalThis.PETI_CONFIG?.quizVersions?.[petType] || "2026v1";
  const res = await fetch(`/data/quiz-${petType}.json?v=${encodeURIComponent(version)}`);
  if (!res.ok) throw new Error("quiz data fetch failed");
  return res.json();
}

const imageWarmups = new Map();
export function prefetchQuizImages(characters, petType) {
  if (imageWarmups.has(petType) || navigator.connection?.saveData) return;
  const download = async (path) => {
    try {
      const response = await fetch(path, { cache: "force-cache", priority: "low", signal: AbortSignal.timeout(20_000) });
      if (response.ok) await response.arrayBuffer();
    } catch { /* 预下载失败不影响答题，展示时仍可正常请求。 */ }
  };
  const warmup = (async () => {
    await download(roleAtlasUrl(petType));
    let next = 0;
    const worker = async () => {
      while (next < characters.length && !document.hidden) {
        const role = characters[next++];
        await download(roleCardUrl(petType, role.id));
      }
    };
    // 两个低优先下载并行，不让图片占满答题和提交请求的连接。
    await Promise.all([worker(), worker()]);
  })();
  imageWarmups.set(petType, warmup);
}
