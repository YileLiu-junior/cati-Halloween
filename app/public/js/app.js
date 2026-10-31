// 落地页：开场命名、继续答题和本浏览器历史结果。
import { getState, setState, initState, getHistory, saveResult, consumeSourceParam, shuffled, petNameCodePoints, fetchQuiz } from "./store.js";
import { initTrack, track } from "./track.js";
import { initHistory } from "./history.js";
import { roleThumbUrl } from "./role-assets.js";

const state = initState();
const source = consumeSourceParam();
if (source) setState({ source });
initTrack();

let petType = state.petType || "cat";
const $ = (id) => document.getElementById(id);
const nameInput = $("petName");
const nameError = $("nameError");
const startBtn = $("startBtn");

function refreshToggle() {
  document.querySelectorAll(".type-btn").forEach((b) => {
    b.classList.toggle("selected", b.dataset.type === petType);
    b.setAttribute("aria-pressed", String(b.dataset.type === petType));
  });
}
document.querySelectorAll(".type-btn").forEach((b) => {
  b.addEventListener("click", () => {
    petType = b.dataset.type;
    refreshToggle();
  });
});
refreshToggle();

const history = getHistory();
$("historySection").classList.toggle("hidden", history.length === 0);
$("historyOpenBtn").textContent = history.length > 3 ? `查看全部 ${history.length} 条 ›` : "历史记录 ›";
// 首页只放最近三条，其余放进历史抽屉，避免落地页被记录撑长。
for (const entry of history.slice(0, 3)) {
  const link = document.createElement("a");
  link.className = "history-item";
  link.href = `/result?testId=${encodeURIComponent(entry.testId)}`;
  const thumb = document.createElement("img");
  thumb.className = "history-thumb";
  thumb.loading = "lazy";
  thumb.decoding = "async";
  thumb.alt = "";
  if (["cat", "dog"].includes(entry.petType) && /^[a-z]{2,16}$/.test(entry.result?.roleId || "")) {
    thumb.src = roleThumbUrl(entry.petType, entry.result.roleId);
  }
  const label = document.createElement("span");
  label.className = "history-label";
  const name = document.createElement("strong");
  name.textContent = entry.petName;
  const role = document.createElement("span");
  role.textContent = entry.result.roleName;
  label.append(name, role);
  link.append(thumb, label);
  link.insertAdjacentHTML("beforeend", '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>');
  $("historyList").appendChild(link);
}
initHistory();
$("continueBtn").classList.toggle("hidden", !state.testId || !state.order || Boolean(state.result));

function showNameError(msg) {
  nameError.textContent = msg;
  nameError.classList.remove("hidden");
}
function hideNameError() {
  nameError.classList.add("hidden");
}
nameInput.addEventListener("input", hideNameError);

function setLoading(on) {
  startBtn.disabled = on;
  startBtn.textContent = on ? "正在加载…" : "开始测试";
}

async function startQuiz() {
  if (startBtn.disabled) return;
  hideNameError();
  const raw = nameInput.value.trim();
  const petName = raw || window.PETI_CONFIG.defaultNames[petType];
  const len = petNameCodePoints(petName);
  if (len < 1 || len > 12) {
    showNameError("名字限 1–12 字，请调整后再开始");
    return;
  }
  setLoading(true);
  try {
    const quizVersion = window.PETI_CONFIG.quizVersions[petType];
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: getState().source || "direct", quizVersion, petType }),
    });
    const data = await res.json();
    if (!res.ok) {
      showNameError(data.code === "RATE_LIMITED" ? "尝试太频繁，请稍后再试" : "加载失败，请重试");
      setLoading(false);
      return;
    }
    const quiz = await fetchQuiz(petType);
    // 每题选项随机排序一次后入 L，本次作答内顺序不变（PRD §3.2）
    const order = {};
    for (const q of quiz.questions) order[q.id] = shuffled(q.options.map((o) => o.id));
    const current = getState();
    if (current.result) saveResult(current);
    setState({
      petType,
      quizVersion,
      testId: data.testId,
      token: data.token,
      petName,
      order,
      answers: {},
      currentQ: 0,
      result: null,
    });
    track("quiz_start", { entry: getState().source || "direct" });
    location.href = "/quiz";
  } catch {
    showNameError("加载失败，请重试");
    setLoading(false);
  }
}
startBtn.addEventListener("click", startQuiz);

// 完成结果直接列在首页；继续入口只用于未完成的测试。
$("continueBtn").addEventListener("click", () => {
  const s = getState();
  if (s.testId && s.order && !s.result) location.href = "/quiz";
  else {
    const el = $("globalError");
    el.textContent = "还没有进行中的测试，先开始一个吧";
    el.classList.remove("hidden");
  }
});
